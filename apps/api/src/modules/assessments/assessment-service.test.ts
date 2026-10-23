import { describe, expect, it, vi } from 'vitest'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import type { KnowledgePoint } from '../content/content-repository.js'
import { InMemoryEventRepository } from '../events/in-memory-event-repository.js'
import type { ModelRouter } from '../models/model-router.js'
import {
  AssessmentService,
  generatedQuestionSchema,
  OpenAiCompatibleQuestionGenerator,
  type QuestionGenerator,
} from './assessment-service.js'
import { InMemoryAssessmentRepository } from './in-memory-assessment-repository.js'

const familyId = '11111111-1111-4111-8111-111111111111'
const kidId = '33333333-3333-4333-8333-333333333333'
const parentId = '22222222-2222-4222-8222-222222222222'
const kpId = '20000000-0000-4000-8000-000000000001'

const generator: QuestionGenerator = {
  isConfigured() {
    return true
  },
  async generate(input) {
    return Array.from({ length: input.count }, (_, index) => {
      const questionType = input.questionTypes[index]!
      return {
        kpId: input.knowledgePoints[index % input.knowledgePoints.length]!.id,
        stem: `动态生成的第 ${index + 1} 道等式性质考察题？`,
        questionType,
        options:
          questionType === 'single_choice'
            ? [
                { key: 'A' as const, text: '正确应用性质' },
                { key: 'B' as const, text: '只改变左边' },
                { key: 'C' as const, text: '只改变右边' },
                { key: 'D' as const, text: '任意改变符号' },
              ]
            : [],
        difficulty: 4 as const,
        answerKey:
          questionType === 'single_choice' ? 'A' : '完整参考解答',
        referenceSteps: ['识别等式两边的运算'],
        scoringPoints: ['正确应用等式性质'],
        hints: [
          '回忆等式两边需要保持怎样的关系。',
          '观察两边是否进行了相同运算。',
          '逐项检查两边的变换是否一致。',
        ],
        optionHints: {
          A: ['检查这一项是否保持等式关系。', '比较等式两边的运算。', '逐项检查两边的变换。'],
          B: ['检查这一项是否保持等式关系。', '比较等式两边的运算。', '逐项检查两边的变换。'],
          C: ['检查这一项是否保持等式关系。', '比较等式两边的运算。', '逐项检查两边的变换。'],
          D: ['检查这一项是否保持等式关系。', '比较等式两边的运算。', '逐项检查两边的变换。'],
        },
      }
    })
  },
}

describe('AssessmentService', () => {
  it('generates questions only when a parent starts an assessment', async () => {
    const content = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const assessments = new InMemoryAssessmentRepository()
    const service = new AssessmentService(
      content,
      new InMemoryEventRepository(),
      assessments,
      generator,
    )
    const before = await content.listQuestionsForParent(familyId)

    const assessment = await service.createParentInitiated({
      familyId,
      kidId,
      createdBy: parentId,
      knowledgePointIds: [kpId],
      purpose: '检查今天学习内容',
      count: 2,
    })

    expect(assessment).toMatchObject({
      trigger: 'parent_initiated',
      knowledgePointIds: [kpId],
      status: 'assigned',
    })
    expect(assessment.questionIds).toHaveLength(2)
    expect(await content.listQuestionsForParent(familyId)).toHaveLength(
      before.length + 2,
    )
    const storedQuestions = await content.listQuestionsForParent(familyId)
    expect(storedQuestions.at(-1)?.optionHints.B).toHaveLength(3)
    expect(
      await assessments.listAssignedQuestionIds(
        familyId,
        kidId,
        assessment.assignedAt.slice(0, 10),
      ),
    ).toEqual(assessment.questionIds)
  })

  it('uses published knowledge points for a routine assessment', async () => {
    const service = new AssessmentService(
      new InMemoryContentRepository({ seedDemoContent: true }),
      new InMemoryEventRepository(),
      new InMemoryAssessmentRepository(),
      generator,
    )

    const assessment = await service.createRoutine({
      familyId,
      kidId,
      createdBy: parentId,
      count: 1,
    })

    expect(assessment.trigger).toBe('routine')
    expect(assessment.questionIds).toHaveLength(1)
  })

  it('creates a weekend paper with mostly subjective hard questions', async () => {
    const content = new InMemoryContentRepository({ seedDemoContent: true })
    const service = new AssessmentService(
      content,
      new InMemoryEventRepository(),
      new InMemoryAssessmentRepository(),
      generator,
    )

    const assessment = await service.createParentInitiated({
      familyId,
      kidId,
      createdBy: parentId,
      knowledgePointIds: [kpId],
      purpose: '周末综合能力训练',
      count: 4,
      deliveryMode: 'weekend_paper',
    })
    const generated = (await content.listQuestionsForParent(familyId)).slice(-4)

    expect(assessment.deliveryMode).toBe('weekend_paper')
    expect(generated.map((item) => item.questionType)).toEqual([
      'single_choice',
      'subjective',
      'subjective',
      'subjective',
    ])
    expect(generated.every((item) => item.difficulty >= 4)).toBe(true)
  })

  it('rejects hints that reveal the answer option', () => {
    const unsafe = {
      kpId,
      stem: '这是一道用于校验安全规则的题目？',
      options: [
        { key: 'A', text: '正确应用性质' },
        { key: 'B', text: '错误选项一' },
        { key: 'C', text: '错误选项二' },
        { key: 'D', text: '错误选项三' },
      ],
      questionType: 'single_choice',
      difficulty: 4,
      answerKey: 'A',
      referenceSteps: ['判断'],
      scoringPoints: ['判断正确'],
      hints: ['答案是 A。', '继续判断。', '检查条件。'],
      optionHints: {
        A: ['答案是 A。', '继续判断。', '检查条件。'],
        B: ['回忆定义。', '继续判断。', '检查条件。'],
        C: ['回忆定义。', '继续判断。', '检查条件。'],
        D: ['回忆定义。', '继续判断。', '检查条件。'],
      },
    }

    expect(generatedQuestionSchema.safeParse(unsafe).success).toBe(false)
  })

  it('rejects numerically equivalent options and keeps diagnosis probes structured', () => {
    const duplicateOptions = {
      kpId,
      stem: '下列哪个数值满足题目给定条件？',
      options: [
        { key: 'A', text: '1/2' },
        { key: 'B', text: '0.5' },
        { key: 'C', text: '2' },
        { key: 'D', text: '3' },
      ],
      questionType: 'single_choice',
      difficulty: 4,
      answerKey: 'A',
      referenceSteps: ['比较数值'],
      scoringPoints: ['识别等价数值'],
      hints: ['先统一形式。', '比较分数和小数。', '逐项换算。'],
      optionHints: {
        A: ['先统一形式。', '比较分数和小数。', '逐项换算。'],
        B: ['先统一形式。', '比较分数和小数。', '逐项换算。'],
        C: ['先统一形式。', '比较分数和小数。', '逐项换算。'],
        D: ['先统一形式。', '比较分数和小数。', '逐项换算。'],
      },
      diagnosisProbes: {
        A: {
          misconceptionCode: 'correct_reasoning',
          description: '正确完成等价换算。',
        },
        B: {
          misconceptionCode: 'equivalent_value',
          description: '没有识别分数与小数等价。',
        },
        C: { misconceptionCode: 'inverse', description: '误取倒数。' },
        D: { misconceptionCode: 'guess', description: '缺少换算过程。' },
      },
    }

    expect(generatedQuestionSchema.safeParse(duplicateOptions).success).toBe(
      false,
    )
  })
})

describe('OpenAiCompatibleQuestionGenerator', () => {
  const knowledgePoint: KnowledgePoint = {
    id: kpId,
    familyId,
    code: 'MATH-01',
    name: '等式的性质',
    chapter: '第一章',
    summary: '等式两边进行相同运算后仍相等。',
    prerequisiteCodes: [],
    status: 'published',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  }

  it('normalizes harmless model output variations before validation', async () => {
    const chatJson = vi.fn().mockResolvedValue({
      data: {
        data: {
          questionList: [
            {
              kpCode: 'MATH-01',
              question: '下列哪项正确使用了等式的基本性质？',
              choices: [
                { label: 'a', content: '等式两边同时加上同一个数' },
                { label: 'b', content: '只改变等式左边' },
                { label: 'c', content: '只改变等式右边' },
                { label: 'd', content: '两边进行不同运算' },
              ],
              difficultyLevel: '4',
              correctAnswer: '选项 a',
              reference_steps: '判断等式两边是否进行了相同运算',
              scoring_points: [{ text: '识别等式性质' }],
              hintLevels: {
                L1: '回忆等式成立需要保持什么关系。',
                L2: '比较等式左右两边的运算。',
                L3: '检查两边是否同时进行了相同运算。',
              },
            },
          ],
        },
      },
      usedFallback: false,
      attempts: 1,
      model: 'test-model',
    })
    const router = {
      isConfigured: () => true,
      chatJson,
    } as unknown as ModelRouter

    const result = await new OpenAiCompatibleQuestionGenerator(router).generate({
      familyId,
      trigger: 'parent_initiated',
      purpose: '检查等式性质',
      count: 1,
      deliveryMode: 'passport',
      questionTypes: ['single_choice'],
      knowledgePoints: [knowledgePoint],
      evidence: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kpId,
      difficulty: 4,
      answerKey: 'A',
      referenceSteps: ['判断等式两边是否进行了相同运算'],
      scoringPoints: ['识别等式性质'],
    })
    expect(result[0]?.options.map((option) => option.key)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ])
    expect(Object.keys(result[0]!.optionHints)).toEqual(['A', 'B', 'C', 'D'])
    expect(result[0]!.optionHints.C).toHaveLength(3)
  })

  it('regenerates when a hint reveals the answer', async () => {
    const baseQuestion = {
      kpId,
      stem: '下列哪项正确使用了等式的基本性质？',
      options: [
        { key: 'A', text: '等式两边同时加上同一个数' },
        { key: 'B', text: '只改变等式左边' },
        { key: 'C', text: '只改变等式右边' },
        { key: 'D', text: '两边进行不同运算' },
      ],
      difficulty: 4,
      answerKey: 'A',
      referenceSteps: ['比较等式两边的运算'],
      scoringPoints: ['识别等式性质'],
    }
    const chatJson = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          questions: [
            {
              ...baseQuestion,
              hints: ['答案是 A。', '比较左右两边。', '检查运算是否相同。'],
            },
          ],
        },
        usedFallback: false,
        attempts: 1,
        model: 'test-model',
      })
      .mockResolvedValueOnce({
        data: {
          questions: [
            {
              ...baseQuestion,
              hints: [
                '回忆等式成立需要保持什么关系。',
                '比较等式左右两边分别进行了什么运算。',
                '检查两边的运算对象和运算符是否一致。',
              ],
            },
          ],
        },
        usedFallback: false,
        attempts: 1,
        model: 'test-model',
      })
    const router = {
      isConfigured: () => true,
      chatJson,
    } as unknown as ModelRouter

    const result = await new OpenAiCompatibleQuestionGenerator(router).generate({
      familyId,
      trigger: 'parent_initiated',
      purpose: '检查等式性质',
      count: 1,
      deliveryMode: 'passport',
      questionTypes: ['single_choice'],
      knowledgePoints: [knowledgePoint],
      evidence: [],
    })

    expect(result[0]?.hints[0]).not.toContain('答案')
    expect(chatJson).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(chatJson.mock.calls[1]?.[1])).toContain(
      '提示中包含答案',
    )
  })
})
