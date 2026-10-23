import { randomUUID } from 'node:crypto'
import { compareKnowledgePointsByPage } from './content-repository.js'
import type {
  ContentRepository,
  ContentStatus,
  CreateKnowledgePointInput,
  CreateQuestionInput,
  DiagnosisProbes,
  HintTuple,
  KnowledgePoint,
  OptionHints,
  QuestionForParent,
  QuestionPrivate,
  QuestionPublic,
} from './content-repository.js'

const demoFamilyId = '11111111-1111-4111-8111-111111111111'

const demoKnowledgePoints: KnowledgePoint[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    familyId: demoFamilyId,
    code: 'M8-EQ-01',
    name: '一元一次方程',
    chapter: '第一章 一元一次方程',
    summary: '理解方程、等式基本性质与一元一次方程的求解。',
    prerequisiteCodes: [],
    status: 'published',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    familyId: demoFamilyId,
    code: 'M8-INEQ-01',
    name: '不等式的基本性质',
    chapter: '第二章 一元一次不等式',
    summary: '理解不等式两边进行相同运算时不等号方向的变化。',
    prerequisiteCodes: [],
    status: 'published',
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
]

const demoQuestionFixtures: Array<
  Omit<
    QuestionForParent,
    'optionHints' | 'questionType' | 'diagnosisProbes'
  >
> = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    familyId: demoFamilyId,
    kpId: '20000000-0000-4000-8000-000000000001',
    knowledgePointName: '一元一次方程',
    stem: '解方程 3x + 5 = 20，第一步最合适的变形是？',
    options: [
      { key: 'A', text: '3x = 20 + 5' },
      { key: 'B', text: '3x = 20 - 5' },
      { key: 'C', text: 'x + 5 = 20 ÷ 3' },
      { key: 'D', text: '3x = 20 × 5' },
    ],
    difficulty: 1,
    status: 'published',
    answerKey: 'B',
    referenceSteps: ['等式两边同时减去 5', '合并常数项'],
    scoringPoints: ['识别移项等价于等式两边同时减去 5'],
    hints: [
      '先观察等号左边，哪一项妨碍 x 所在的项单独留下？',
      '要消去左边的 +5，等式两边需要进行同一种什么运算？',
      '先只处理常数项：等式两边同时减去 5，再观察新的等式。',
    ],
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    familyId: demoFamilyId,
    kpId: '20000000-0000-4000-8000-000000000001',
    knowledgePointName: '一元一次方程',
    stem: '方程 2(x - 1) = 8 中，去括号后应得到哪一个式子？',
    options: [
      { key: 'A', text: '2x - 1 = 8' },
      { key: 'B', text: '2x - 2 = 8' },
      { key: 'C', text: '2x + 2 = 8' },
      { key: 'D', text: 'x - 2 = 8' },
    ],
    difficulty: 1,
    status: 'published',
    answerKey: 'B',
    referenceSteps: ['用 2 分别乘括号内两项', '保留 -1 的符号'],
    scoringPoints: ['正确应用乘法分配律'],
    hints: [
      '括号外的数要和括号内的哪些项相乘？',
      '把 2 分别乘以 x 和 -1，先不要继续求 x。',
      '关注常数项：2 乘以 -1 后仍然带负号。',
    ],
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    familyId: demoFamilyId,
    kpId: '20000000-0000-4000-8000-000000000002',
    knowledgePointName: '不等式的基本性质',
    stem: '若 a > b，则下列不等式一定成立的是？',
    options: [
      { key: 'A', text: 'a - 3 < b - 3' },
      { key: 'B', text: '2a > 2b' },
      { key: 'C', text: '-a > -b' },
      { key: 'D', text: 'a ÷ 2 < b ÷ 2' },
    ],
    difficulty: 2,
    status: 'published',
    answerKey: 'B',
    referenceSteps: ['逐项识别两边的运算', '判断不等号方向是否改变'],
    scoringPoints: ['知道同乘正数不改变不等号方向'],
    hints: [
      '逐项判断时，先想想不等式两边做相同运算后方向是否改变。',
      '加减同一个数不改变方向；乘除正数也不改变方向。',
      '先找两边同乘一个正数的选项，再判断方向。',
    ],
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
  },
]

const demoQuestions: QuestionForParent[] = demoQuestionFixtures.map(
  (question) => ({
    ...question,
    questionType: 'single_choice',
    optionHints: repeatHintsForOptions(question.hints),
    diagnosisProbes: defaultDiagnosisProbes(question.answerKey),
  }),
)

export class InMemoryContentRepository implements ContentRepository {
  private readonly knowledgePoints: Map<string, KnowledgePoint>
  private readonly questions: Map<string, QuestionForParent>

  constructor(options: { seedDemoContent?: boolean } = {}) {
    const knowledgePoints = options.seedDemoContent ? demoKnowledgePoints : []
    const questions = options.seedDemoContent ? demoQuestions : []
    this.knowledgePoints = new Map(
      knowledgePoints.map((item) => [item.id, structuredClone(item)]),
    )
    this.questions = new Map(
      questions.map((item) => [item.id, structuredClone(item)]),
    )
  }

  async listKnowledgePoints(familyId: string): Promise<KnowledgePoint[]> {
    return [...this.knowledgePoints.values()]
      .filter((item) => item.familyId === familyId)
      .sort(compareKnowledgePointsByPage)
  }

  async createKnowledgePoint(
    familyId: string,
    input: CreateKnowledgePointInput,
  ): Promise<KnowledgePoint> {
    const duplicate = [...this.knowledgePoints.values()].some(
      (item) => item.familyId === familyId && item.code === input.code,
    )
    if (duplicate) throw new Error('KNOWLEDGE_POINT_CODE_CONFLICT')

    const timestamp = new Date().toISOString()
    const item: KnowledgePoint = {
      id: randomUUID(),
      familyId,
      code: input.code,
      name: input.name,
      chapter: input.chapter,
      summary: input.summary ?? '',
      ...(input.sourcePageStart
        ? { sourcePageStart: input.sourcePageStart }
        : {}),
      ...(input.sourcePageEnd ? { sourcePageEnd: input.sourcePageEnd } : {}),
      prerequisiteCodes: input.prerequisiteCodes ?? [],
      status: input.status,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.knowledgePoints.set(item.id, item)
    return item
  }

  async setKnowledgePointStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<KnowledgePoint | undefined> {
    const item = this.knowledgePoints.get(id)
    if (!item || item.familyId !== familyId) return undefined
    item.status = status
    item.updatedAt = new Date().toISOString()
    return item
  }

  async listQuestionsForParent(familyId: string): Promise<QuestionForParent[]> {
    return [...this.questions.values()]
      .filter((item) => item.familyId === familyId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async createQuestion(
    familyId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionForParent> {
    const knowledgePoint = this.knowledgePoints.get(input.kpId)
    if (!knowledgePoint || knowledgePoint.familyId !== familyId) {
      throw new Error('KNOWLEDGE_POINT_NOT_FOUND')
    }
    if (input.status === 'published' && knowledgePoint.status !== 'published') {
      throw new Error('KNOWLEDGE_POINT_NOT_PUBLISHED')
    }

    const timestamp = new Date().toISOString()
    const item: QuestionForParent = {
      id: randomUUID(),
      familyId,
      ...input,
      knowledgePointName: knowledgePoint.name,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.questions.set(item.id, item)
    return item
  }

  async setQuestionStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<QuestionForParent | undefined> {
    const item = this.questions.get(id)
    if (!item || item.familyId !== familyId) return undefined
    const knowledgePoint = this.knowledgePoints.get(item.kpId)
    if (status === 'published' && knowledgePoint?.status !== 'published') {
      throw new Error('KNOWLEDGE_POINT_NOT_PUBLISHED')
    }
    item.status = status
    item.updatedAt = new Date().toISOString()
    return item
  }

  async listPublishedQuestionsByIds(
    familyId: string,
    questionIds: string[],
  ): Promise<QuestionPublic[]> {
    return questionIds.flatMap((id) => {
      const item = this.questions.get(id)
      return item?.familyId === familyId && item.status === 'published'
        ? [this.toPublic(item)]
        : []
    })
  }

  async findPublishedQuestion(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPublic | undefined> {
    const item = this.questions.get(questionId)
    if (!item || item.familyId !== familyId || item.status !== 'published') {
      return undefined
    }
    return this.toPublic(item)
  }

  async findQuestionPrivate(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPrivate | undefined> {
    const item = this.questions.get(questionId)
    if (!item || item.familyId !== familyId || item.status !== 'published') {
      return undefined
    }
    return {
      questionId: item.id,
      familyId: item.familyId,
      answerKey: item.answerKey,
      referenceSteps: [...item.referenceSteps],
      scoringPoints: [...item.scoringPoints],
      hints: [...item.hints],
      optionHints: structuredClone(item.optionHints),
      diagnosisProbes: structuredClone(item.diagnosisProbes),
    }
  }

  async close(): Promise<void> {}

  private toPublic(item: QuestionForParent): QuestionPublic {
    return {
      id: item.id,
      familyId: item.familyId,
      kpId: item.kpId,
      knowledgePointName: item.knowledgePointName,
      stem: item.stem,
      options: structuredClone(item.options),
      questionType: item.questionType,
      difficulty: item.difficulty,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }
}

function repeatHintsForOptions(hints: HintTuple): OptionHints {
  return {
    A: [...hints],
    B: [...hints],
    C: [...hints],
    D: [...hints],
  }
}

function defaultDiagnosisProbes(answerKey: string): DiagnosisProbes {
  return Object.fromEntries(
    ['A', 'B', 'C', 'D'].map((key) => [
      key,
      {
        misconceptionCode:
          key === answerKey ? 'correct_reasoning' : `option_${key.toLowerCase()}`,
        description:
          key === answerKey
            ? '正确应用目标知识点。'
            : `选择 ${key} 时需要复查目标知识点的适用条件。`,
      },
    ]),
  ) as DiagnosisProbes
}
