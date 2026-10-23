import { describe, expect, it, vi } from 'vitest'
import { contextForTest } from '../../app.js'
import { InMemoryContentRepository } from '../content/in-memory-content-repository.js'
import {
  GuideService,
  InMemoryGuideAuditRepository,
  type GuideGenerator,
} from '../guide/guide-service.js'
import { TrainingService } from './training-service.js'
import { InMemoryTrainingStateRepository } from './training-state-repository.js'

const questionIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
]

describe('TrainingService', () => {
  function createService(
    generator: GuideGenerator = safeGenerator,
    initialNow = '2026-10-10T00:00:00.000Z',
  ) {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    let now = new Date(initialNow)
    let assignedQuestions = [...questionIds]
    const state = new InMemoryTrainingStateRepository()
    const service = new TrainingService(
      repository,
      repository,
      {
        async save() {},
        async list() {
          return []
        },
        async listAssignedQuestionIds() {
          return assignedQuestions
        },
        async isQuestionAssigned() {
          return true
        },
        async close() {},
      },
      state,
      new GuideService(generator, new InMemoryGuideAuditRepository()),
      () => now,
    )
    return {
      service,
      state,
      setNow(value: string) {
        now = new Date(value)
      },
      setAssigned(value: string[]) {
        assignedQuestions = [...value]
      },
    }
  }

  it('never exposes answers or hint templates in the training payload', async () => {
    const payload = await createService().service.getToday(contextForTest())
    const serialized = JSON.stringify(payload)
    expect(payload.questions).toHaveLength(3)
    expect(serialized).not.toContain('answerKey')
    expect(serialized).not.toContain('"hints"')
    expect(payload.budget).toMatchObject({
      elapsedSeconds: 0,
      stopAddingQuestions: false,
      sessionClosed: false,
    })
  })

  it('advances hint levels on the server and does not jump directly to L3', async () => {
    const { service } = createService()
    const context = contextForTest()
    const questionId = questionIds[0]!
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await service.getToday(context)
    await service.startAttempt(context, { attemptId, questionId })
    const first = await service.getHint(context, {
      attemptId,
      questionId,
      selectedAnswer: 'A',
      kidInput: '不会',
    })
    const second = await service.getHint(context, {
      attemptId,
      questionId,
      selectedAnswer: 'A',
      kidInput: '还是不会',
    })
    expect(first.hintLevel).toBe(1)
    expect(second.hintLevel).toBe(2)
    expect(first.text).not.toContain('x =')
    expect(second.text).not.toContain('x =')
  })

  it('returns a precomputed option hint without calling the guide model', async () => {
    const generate = vi.fn(safeGenerator.generate)
    const { service } = createService({
      ...safeGenerator,
      generate,
    })
    const context = contextForTest()
    const questionId = questionIds[0]!
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await service.getToday(context)
    await service.startAttempt(context, { attemptId, questionId })

    const result = await service.getHint(context, {
      attemptId,
      questionId,
      selectedAnswer: 'A',
      kidInput: '不会',
    })

    expect(result).toMatchObject({
      hintLevel: 1,
      safetyResult: 'pass',
      text: '先观察等号左边，哪一项妨碍 x 所在的项单独留下？',
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('binds an attempt to its family and child', async () => {
    const { service } = createService()
    const context = contextForTest()
    const questionId = questionIds[0]!
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await service.getToday(context)
    await service.startAttempt(context, { attemptId, questionId })
    await expect(
      service.getHint(
        contextForTest({
          userId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          kidId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        }),
        { attemptId, questionId, selectedAnswer: 'A', kidInput: '继续' },
      ),
    ).rejects.toThrow('TRAINING_SESSION_NOT_FOUND')
  })

  it('stops new questions at 25 minutes and closes after the current question at 30', async () => {
    const { service, setNow } = createService()
    const context = contextForTest()
    const firstAttempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await service.getToday(context)
    await service.startAttempt(context, {
      attemptId: firstAttempt,
      questionId: questionIds[0]!,
    })
    setNow('2026-10-10T00:25:00.000Z')
    await expect(
      service.startAttempt(context, {
        attemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        questionId: questionIds[1]!,
      }),
    ).rejects.toThrow('SESSION_LIMIT_REACHED')
    setNow('2026-10-10T00:30:01.000Z')
    const result = await service.checkAnswer(context, {
      attemptId: firstAttempt,
      questionId: questionIds[0]!,
      answer: 'B',
    })
    expect(result.correct).toBe(true)
    expect(result.budget.sessionClosed).toBe(true)
  })

  it('starts the time budget only when the first question begins', async () => {
    const { service, setNow } = createService()
    const context = contextForTest()
    const before = await service.getToday(context)
    expect(before.budget.serverStartedAt).toBeNull()

    setNow('2026-10-10T01:00:00.000Z')
    const started = await service.startAttempt(context, {
      attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      questionId: questionIds[0]!,
    })

    expect(started.budget).toMatchObject({
      serverStartedAt: '2026-10-10T01:00:00.000Z',
      elapsedSeconds: 0,
      stopAddingQuestions: false,
      sessionClosed: false,
    })
  })

  it('records authoritative answer evidence with the current hint level', async () => {
    const { service, state } = createService()
    const context = contextForTest()
    const questionId = questionIds[0]!
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await service.startAttempt(context, { attemptId, questionId })
    await service.checkAnswer(context, {
      submissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      attemptId,
      questionId,
      answer: 'A',
    })
    await service.getHint(context, {
      attemptId,
      questionId,
      selectedAnswer: 'A',
      kidInput: '不会',
    })
    await service.checkAnswer(context, {
      submissionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      attemptId,
      questionId,
      answer: 'B',
    })

    await expect(
      state.listAnswerEvidence(context.familyId, context.kidId!),
    ).resolves.toMatchObject([
      { correct: false, hintLevel: 0 },
      { correct: true, hintLevel: 1 },
    ])
  })

  it('returns the original result when an answer submission is replayed', async () => {
    const { service, state } = createService()
    const context = contextForTest()
    const questionId = questionIds[0]!
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const submissionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await service.startAttempt(context, { attemptId, questionId })

    const first = await service.checkAnswer(context, {
      submissionId,
      attemptId,
      questionId,
      answer: 'B',
    })
    const replayed = await service.checkAnswer(context, {
      submissionId,
      attemptId,
      questionId,
      answer: 'B',
    })

    expect(replayed).toMatchObject({
      correct: first.correct,
      nextAction: first.nextAction,
    })
    await expect(
      state.listAnswerEvidence(context.familyId, context.kidId!),
    ).resolves.toHaveLength(1)
  })

  it('finalizes an offline replay even when the answer is wrong', async () => {
    const { service, state } = createService()
    const context = contextForTest()
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const submissionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    await service.startAttempt(context, {
      attemptId,
      questionId: questionIds[0]!,
    })

    const first = await service.checkAnswer(context, {
      submissionId,
      attemptId,
      questionId: questionIds[0]!,
      answer: 'A',
      finalizeAttempt: true,
    })
    const replayed = await service.checkAnswer(context, {
      submissionId,
      attemptId,
      questionId: questionIds[0]!,
      answer: 'A',
      finalizeAttempt: true,
    })
    await expect(
      service.startAttempt(context, {
        attemptId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        questionId: questionIds[1]!,
      }),
    ).resolves.toBeDefined()

    expect(first.correct).toBe(false)
    expect(replayed.correct).toBe(false)
    await expect(
      state.listAnswerEvidence(context.familyId, context.kidId!),
    ).resolves.toHaveLength(1)
  })

  it('grades subjective answers without exposing the reference answer', async () => {
    const repository = new InMemoryContentRepository({
      seedDemoContent: true,
    })
    const question = await repository.createQuestion(
      contextForTest().familyId,
      {
        kpId: '20000000-0000-4000-8000-000000000001',
        stem: '请写出完整推理，说明这个方程为什么只有一个解。',
        questionType: 'subjective',
        options: [],
        difficulty: 5,
        status: 'published',
        answerKey: '参考答案只应留在服务端',
        referenceSteps: ['建立等价变形链', '说明解的唯一性'],
        scoringPoints: ['变形等价', '结论有依据'],
        hints: ['先说明每一步为何等价。', '检查是否可逆。', '补充唯一性的依据。'],
        optionHints: {
          A: ['先说明每一步为何等价。', '检查是否可逆。', '补充唯一性的依据。'],
          B: ['先说明每一步为何等价。', '检查是否可逆。', '补充唯一性的依据。'],
          C: ['先说明每一步为何等价。', '检查是否可逆。', '补充唯一性的依据。'],
          D: ['先说明每一步为何等价。', '检查是否可逆。', '补充唯一性的依据。'],
        },
        diagnosisProbes: {
          A: { misconceptionCode: 'subjective', description: '主观题通用诊断。' },
          B: { misconceptionCode: 'subjective', description: '主观题通用诊断。' },
          C: { misconceptionCode: 'subjective', description: '主观题通用诊断。' },
          D: { misconceptionCode: 'subjective', description: '主观题通用诊断。' },
        },
      },
    )
    const state = new InMemoryTrainingStateRepository()
    const grade = vi.fn().mockResolvedValue({
      correct: true,
      score: 82,
      feedback: '主要推理完整，注意把等价变形依据写清楚。',
    })
    const service = new TrainingService(
      repository,
      repository,
      {
        async save() {},
        async list() {
          return []
        },
        async listAssignedQuestionIds() {
          return [question.id]
        },
        async isQuestionAssigned() {
          return true
        },
        async close() {},
      },
      state,
      new GuideService(safeGenerator, new InMemoryGuideAuditRepository()),
      () => new Date('2026-10-10T00:00:00.000Z'),
      { isConfigured: () => true, grade },
    )
    const context = contextForTest()
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

    const training = await service.getToday(context)
    expect(JSON.stringify(training)).not.toContain('参考答案')
    await service.startAttempt(context, { attemptId, questionId: question.id })
    const result = await service.checkAnswer(context, {
      attemptId,
      questionId: question.id,
      answer: '学生写出的推理过程',
    })

    expect(result).toMatchObject({
      correct: true,
      score: 82,
      feedback: '主要推理完整，注意把等价变形依据写清楚。',
    })
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        answer: '学生写出的推理过程',
        privateQuestion: expect.objectContaining({
          answerKey: '参考答案只应留在服务端',
        }),
      }),
    )
  })

  it('does not consume the daily budget while no training is assigned', async () => {
    const { service, setNow, setAssigned } = createService()
    const context = contextForTest()
    setAssigned([])
    const empty = await service.getToday(context)
    expect(empty.budget.serverStartedAt).toBeNull()
    setNow('2026-10-10T01:00:00.000Z')
    setAssigned([questionIds[0]!])
    const assigned = await service.getToday(context)
    expect(assigned.budget.elapsedSeconds).toBe(0)
    expect(assigned.budget.stopAddingQuestions).toBe(false)
  })
})

const safeGenerator: GuideGenerator = {
  isConfigured() {
    return true
  },
  async generate(input) {
    return {
      text:
        input.level === 1
          ? '先想一想应该用哪个定义判断。'
          : '把已知条件逐条列出，再找它们之间的关系。',
      model: 'test-guide',
      promptVersion: 'test-v1',
    }
  },
}
