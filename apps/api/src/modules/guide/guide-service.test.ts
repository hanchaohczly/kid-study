import { describe, expect, it } from 'vitest'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import {
  GuideSafetyChecker,
  GuideService,
  InMemoryGuideAuditRepository,
  type GuideGenerator,
  type GuideGeneratorInput,
} from './guide-service.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const kidId = '33333333-3333-4333-8333-333333333333'
const questionId = '10000000-0000-4000-8000-000000000001'
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('GuideService', () => {
  it('does not pass private answers to the generator', async () => {
    const inputs: GuideGeneratorInput[] = []
    const result = await createGuide({
      isConfigured: () => true,
      async generate(input) {
        inputs.push(input)
        return {
          text: '先观察哪个常数项需要处理？',
          model: 'test',
          promptVersion: 'test-v1',
        }
      },
    })
    expect(result.safetyResult).toBe('pass')
    expect(JSON.stringify(inputs)).not.toContain('answerKey')
    expect(JSON.stringify(inputs)).not.toContain('referenceSteps')
  })

  it('blocks an answer leak and regenerates before returning', async () => {
    let calls = 0
    const audit = new InMemoryGuideAuditRepository()
    const result = await createGuide(
      {
        isConfigured: () => true,
        async generate() {
          calls += 1
          return {
            text:
              calls === 1
                ? '答案是 B，也就是 3x = 20 - 5。'
                : '先观察等号左边哪个常数项妨碍未知数项单独留下？',
            model: 'test',
            promptVersion: 'test-v1',
          }
        },
      },
      audit,
    )
    expect(calls).toBe(2)
    expect(result.safetyResult).toBe('blocked_regenerated')
    expect(result.text).not.toContain('答案')
    expect(audit.records[0]?.safetyResult).toBe('blocked')
  })

  it('falls back after three blocked generations', async () => {
    let calls = 0
    const result = await createGuide({
      isConfigured: () => true,
      async generate() {
        calls += 1
        return {
          text: '正确选项是 B。',
          model: 'test',
          promptVersion: 'test-v1',
        }
      },
    })
    expect(calls).toBe(3)
    expect(result.safetyResult).toBe('blocked_fallback')
    expect(result.text).not.toContain('B')
  })

  it('fails closed when the semantic checker is unavailable', async () => {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const question = await repository.findPublishedQuestion(familyId, questionId)
    const privateQuestion = await repository.findQuestionPrivate(
      familyId,
      questionId,
    )
    const service = new GuideService(
      {
        isConfigured: () => true,
        async generate() {
          return {
            text: '先判断需要使用哪个定义。',
            model: 'test',
            promptVersion: 'test-v1',
          }
        },
      },
      new InMemoryGuideAuditRepository(),
      undefined,
      {
        async check() {
          throw new Error('timeout')
        },
      },
    )
    const result = await service.create({
      familyId,
      kidId,
      attemptId,
      question: question!,
      privateQuestion: privateQuestion!,
      kidInput: '不会',
      level: 1,
    })
    expect(result.safetyResult).toBe('blocked_fallback')
  })

  it('audits and returns a safe precomputed hint without model generation', async () => {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const question = await repository.findPublishedQuestion(familyId, questionId)
    const privateQuestion = await repository.findQuestionPrivate(
      familyId,
      questionId,
    )
    const audit = new InMemoryGuideAuditRepository()
    const generate = async () => {
      throw new Error('model should not be called')
    }
    const service = new GuideService(
      { isConfigured: () => true, generate },
      audit,
    )

    const result = await service.createPrecomputed({
      familyId,
      kidId,
      attemptId,
      question: question!,
      privateQuestion: privateQuestion!,
      text: privateQuestion!.optionHints.A[0],
      level: 1,
    })

    expect(result?.text).toBe(privateQuestion!.optionHints.A[0])
    expect(audit.records[0]).toMatchObject({
      generatorModel: 'precomputed-option-hint',
      promptVersion: 'option-hints-v1',
      safetyResult: 'pass',
    })
  })
})

describe('GuideSafetyChecker', () => {
  it('blocks correct option text and excessive level information', async () => {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const question = await repository.findPublishedQuestion(familyId, questionId)
    const privateQuestion = await repository.findQuestionPrivate(
      familyId,
      questionId,
    )
    const result = new GuideSafetyChecker().check({
      text: `先写出 3x = 20 - 5。${'继续推导。'.repeat(30)}`,
      level: 1,
      question: question!,
      privateQuestion: privateQuestion!,
    })
    expect(result.pass).toBe(false)
    expect(result.reasons).toContain('ANSWER_TEXT_MATCH')
    expect(result.reasons).toContain('LEVEL_INFORMATION_EXCEEDED')
  })

  it('blocks all 216 adversarial answer-expression variants', async () => {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const question = await repository.findPublishedQuestion(familyId, questionId)
    const privateQuestion = await repository.findQuestionPrivate(
      familyId,
      questionId,
    )
    const candidates = [
      '答案',
      '正确选项',
      '应选',
      '最终结果',
    ].flatMap((prefix) =>
      ['是', '为', '：', ':', ' 是 ', ' 为 '].flatMap((separator) =>
        ['A', 'B', 'C'].flatMap((option) =>
          ['', '。', '，请直接填写。'].map(
            (suffix) => `${prefix}${separator}${option}${suffix}`,
          ),
        ),
      ),
    )

    expect(candidates).toHaveLength(216)
    for (const text of candidates) {
      const result = new GuideSafetyChecker().check({
        text,
        level: 1,
        question: question!,
        privateQuestion: privateQuestion!,
      })
      expect(result.reasons, text).toContain('ANSWER_EXPRESSION')
    }
  })
})

async function createGuide(
  generator: GuideGenerator,
  audit = new InMemoryGuideAuditRepository(),
) {
  const repository = new InMemoryContentRepository({
    seedDemoContent: true,
  })
  const question = await repository.findPublishedQuestion(familyId, questionId)
  const privateQuestion = await repository.findQuestionPrivate(
    familyId,
    questionId,
  )
  return new GuideService(generator, audit).create({
    familyId,
    kidId,
    attemptId,
    question: question!,
    privateQuestion: privateQuestion!,
    kidInput: '我不会',
    level: 1,
  })
}
