import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type {
  ContentRepository,
  KnowledgePoint,
  QuestionType,
} from '../content/content-repository.js'
import type {
  EventRepository,
  StoredLearningEvent,
} from '../events/event-repository.js'
import type { ModelRouter } from '../models/model-router.js'

const optionSchema = z.object({
  key: z.enum(['A', 'B', 'C', 'D']),
  text: z.string().trim().min(1).max(300),
})

const hintTupleSchema = z.tuple([
  z.string().trim().min(1).max(500),
  z.string().trim().min(1).max(500),
  z.string().trim().min(1).max(500),
])

const optionHintsSchema = z.object({
  A: hintTupleSchema,
  B: hintTupleSchema,
  C: hintTupleSchema,
  D: hintTupleSchema,
})
const diagnosisProbeSchema = z.object({
  misconceptionCode: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
})
const diagnosisProbesSchema = z.object({
  A: diagnosisProbeSchema,
  B: diagnosisProbeSchema,
  C: diagnosisProbeSchema,
  D: diagnosisProbeSchema,
})
const defaultDiagnosisProbes = {
  A: { misconceptionCode: 'option_a', description: '检查选择 A 时的判断依据。' },
  B: { misconceptionCode: 'option_b', description: '检查选择 B 时的判断依据。' },
  C: { misconceptionCode: 'option_c', description: '检查选择 C 时的判断依据。' },
  D: { misconceptionCode: 'option_d', description: '检查选择 D 时的判断依据。' },
}

export const generatedQuestionSchema = z
  .object({
    kpId: z.uuid(),
    stem: z.string().trim().min(5).max(1_000),
    questionType: z.enum(['single_choice', 'subjective']),
    options: z.array(optionSchema).max(4),
    difficulty: z.union([z.literal(4), z.literal(5)]),
    answerKey: z.string().trim().min(1).max(2_000),
    referenceSteps: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    scoringPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    hints: hintTupleSchema,
    optionHints: optionHintsSchema,
    diagnosisProbes: diagnosisProbesSchema.default(defaultDiagnosisProbes),
  })
  .superRefine((question, context) => {
    if (
      question.questionType === 'subjective' &&
      question.options.length !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '主观题不得包含选择项',
      })
    }
    if (
      question.questionType === 'single_choice' &&
      !['A', 'B', 'C', 'D'].includes(question.answerKey)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answerKey'],
        message: '客观题答案必须是 A/B/C/D',
      })
    }
    if (question.questionType === 'subjective') return
    const keys = question.options.map((option) => option.key)
    if (new Set(keys).size !== 4 || keys.join('') !== 'ABCD') {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '题目选项必须按顺序包含唯一的 A/B/C/D',
      })
    }
    const normalizedOptionTexts = question.options.map((option) =>
      normalizeComparableText(option.text),
    )
    if (new Set(normalizedOptionTexts).size !== normalizedOptionTexts.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '题目选项存在重复或等价文本',
      })
    }
    const numericValues = question.options.map((option) =>
      numericValue(option.text),
    )
    const comparableNumbers = numericValues.filter(
      (value): value is number => value !== undefined,
    )
    if (
      comparableNumbers.length >= 2 &&
      new Set(comparableNumbers.map((value) => value.toPrecision(12))).size !==
        comparableNumbers.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: '题目选项存在数值等价项',
      })
    }
    const answerText = question.options.find(
      (option) => option.key === question.answerKey,
    )?.text
    const normalizedAnswer = answerText?.replace(/\s+/g, '')
    const allHints = [
      ...question.hints,
      ...Object.values(question.optionHints).flat(),
    ]
    if (
      allHints.some((hint) => {
        const normalized = hint.replace(/\s+/g, '')
        return (
          new RegExp(`(?:答案|选项|选择|应选)(?:是|为|：|:)?${question.answerKey}`).test(
            normalized,
          ) ||
          Boolean(
            normalizedAnswer &&
              normalizedAnswer.length >= 2 &&
              normalized.includes(normalizedAnswer),
          )
        )
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['optionHints'],
        message: '提示中包含答案',
      })
    }
  })

const generatedAssessmentSchema = z.object({
  questions: z.array(generatedQuestionSchema).min(1).max(8),
})

export type AssessmentTrigger = 'routine' | 'parent_initiated'
export type AssessmentDeliveryMode = 'passport' | 'weekend_paper'
export type AssessmentSelectionMode = 'manual' | 'auto_core'
export type GeneratedQuestion = z.input<typeof generatedQuestionSchema>

export interface Assessment {
  id: string
  familyId: string
  kidId: string
  trigger: AssessmentTrigger
  deliveryMode: AssessmentDeliveryMode
  selectionMode: AssessmentSelectionMode
  purpose: string
  knowledgePointIds: string[]
  questionIds: string[]
  evidenceSummary: AssessmentEvidence[]
  status: 'assigned'
  createdBy: string
  createdAt: string
  assignedAt: string
}

export interface AssessmentEvidence {
  type: string
  occurredAt: string
  kpIds: string[]
}

export interface AssessmentRepository {
  save(assessment: Assessment): Promise<void>
  list(familyId: string, kidId: string): Promise<Assessment[]>
  listAssignedQuestionIds(
    familyId: string,
    kidId: string,
    localDate: string,
  ): Promise<string[]>
  isQuestionAssigned(
    familyId: string,
    kidId: string,
    questionId: string,
  ): Promise<boolean>
  close(): Promise<void>
}

export interface QuestionGenerator {
  isConfigured(familyId: string): boolean
  generate(input: {
    familyId: string
    trigger: AssessmentTrigger
    purpose: string
    count: number
    deliveryMode: AssessmentDeliveryMode
    questionTypes: QuestionType[]
    knowledgePoints: KnowledgePoint[]
    evidence: AssessmentEvidence[]
  }): Promise<GeneratedQuestion[]>
}

export class AssessmentService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly eventRepository: EventRepository,
    private readonly assessmentRepository: AssessmentRepository,
    private readonly generator: QuestionGenerator | undefined,
  ) {}

  isConfigured(familyId: string): boolean {
    return Boolean(this.generator?.isConfigured(familyId))
  }

  list(familyId: string, kidId: string): Promise<Assessment[]> {
    return this.assessmentRepository.list(familyId, kidId)
  }

  async createParentInitiated(input: {
    familyId: string
    kidId: string
    createdBy: string
    knowledgePointIds: string[]
    purpose: string
    count: number
    deliveryMode?: AssessmentDeliveryMode
    selectionMode?: AssessmentSelectionMode
  }): Promise<Assessment> {
    return this.create({
      ...input,
      trigger: 'parent_initiated',
      deliveryMode: input.deliveryMode ?? 'passport',
      selectionMode: input.selectionMode ?? 'manual',
    })
  }

  async createRoutine(input: {
    familyId: string
    kidId: string
    createdBy: string
    count: number
  }): Promise<Assessment> {
    const knowledgePoints = (
      await this.contentRepository.listKnowledgePoints(input.familyId)
    ).filter((item) => item.status === 'published')
    if (!knowledgePoints.length) throw new Error('NO_PUBLISHED_KNOWLEDGE_POINTS')

    const events = await this.eventsForKid(input.familyId, input.kidId)
    const targets = (
      await this.recommendKnowledgePoints(input.familyId, input.kidId, 2)
    ).map((item) => item.id)

    return this.create({
      ...input,
      trigger: 'routine',
      deliveryMode: 'passport',
      selectionMode: 'auto_core',
      knowledgePointIds: targets,
      purpose: events.length
        ? '基于近期学习记录进行例行复验'
        : '建立当前知识掌握度基线',
    })
  }

  async recommendKnowledgePoints(
    familyId: string,
    kidId: string,
    count = 6,
  ): Promise<Array<{ id: string; score: number; reasons: string[] }>> {
    const knowledgePoints = (
      await this.contentRepository.listKnowledgePoints(familyId)
    ).filter((item) => item.status === 'published')
    const events = await this.eventsForKid(familyId, kidId)
    const activity = new Map<string, number>()
    const hints = new Map<string, number>()
    for (const event of events) {
      for (const kpId of event.kpIds) {
        activity.set(kpId, (activity.get(kpId) ?? 0) + 1)
        if (event.type === 'hint_requested' || event.type === 'hint_used') {
          hints.set(kpId, (hints.get(kpId) ?? 0) + 1)
        }
      }
    }
    const prerequisiteUse = new Map<string, number>()
    for (const point of knowledgePoints) {
      for (const code of point.prerequisiteCodes) {
        prerequisiteUse.set(code, (prerequisiteUse.get(code) ?? 0) + 1)
      }
    }
    const ranked = knowledgePoints
      .map((point) => {
        const heat = activity.get(point.id) ?? 0
        const hintHeat = hints.get(point.id) ?? 0
        const core = prerequisiteUse.get(point.code) ?? 0
        const score = heat * 3 + hintHeat * 4 + core * 2 + 1
        const reasons = [
          ...(hintHeat ? ['近期提示依赖较高'] : []),
          ...(heat ? ['近期学习热度较高'] : []),
          ...(core ? ['前置关系中的核心知识'] : []),
          ...(!heat && !hintHeat && !core ? ['核心知识覆盖'] : []),
        ]
        return { id: point.id, chapter: point.chapter, score, reasons }
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.id.localeCompare(right.id),
      )

    const selected: typeof ranked = []
    const chapterCounts = new Map<string, number>()
    while (selected.length < Math.min(count, ranked.length)) {
      const next = ranked
        .filter((item) => !selected.includes(item))
        .sort(
          (left, right) =>
            (chapterCounts.get(left.chapter) ?? 0) -
              (chapterCounts.get(right.chapter) ?? 0) ||
            right.score - left.score,
        )[0]
      if (!next) break
      selected.push(next)
      chapterCounts.set(next.chapter, (chapterCounts.get(next.chapter) ?? 0) + 1)
    }
    return selected.map(({ chapter: _, ...item }) => item)
  }

  async listAssignedQuestionIds(
    familyId: string,
    kidId: string,
    localDate: string,
  ): Promise<string[]> {
    return this.assessmentRepository.listAssignedQuestionIds(
      familyId,
      kidId,
      localDate,
    )
  }

  async close(): Promise<void> {
    await this.assessmentRepository.close()
  }

  private async create(input: {
    familyId: string
    kidId: string
    createdBy: string
    trigger: AssessmentTrigger
    deliveryMode: AssessmentDeliveryMode
    selectionMode: AssessmentSelectionMode
    knowledgePointIds: string[]
    purpose: string
    count: number
  }): Promise<Assessment> {
    if (!this.generator?.isConfigured(input.familyId)) {
      throw new Error('LLM_NOT_CONFIGURED')
    }
    const requestedIds = new Set(input.knowledgePointIds)
    const knowledgePoints = (
      await this.contentRepository.listKnowledgePoints(input.familyId)
    ).filter(
      (item) => item.status === 'published' && requestedIds.has(item.id),
    )
    if (knowledgePoints.length !== requestedIds.size) {
      throw new Error('KNOWLEDGE_POINT_NOT_FOUND')
    }

    const events = await this.eventsForKid(input.familyId, input.kidId)
    const evidence = events
      .filter((event) => event.kpIds.some((kpId) => requestedIds.has(kpId)))
      .slice(-30)
      .map(toEvidence)
    const questionTypes = questionTypesFor(input.deliveryMode, input.count)
    const generated = await this.generator.generate({
      familyId: input.familyId,
      trigger: input.trigger,
      purpose: input.purpose,
      count: input.count,
      deliveryMode: input.deliveryMode,
      questionTypes,
      knowledgePoints,
      evidence,
    })
    const parsed = generatedAssessmentSchema.parse({ questions: generated })
    if (parsed.questions.length !== input.count) {
      throw new Error('LLM_QUESTION_COUNT_MISMATCH')
    }
    if (
      parsed.questions.some(
        (question) => !requestedIds.has(question.kpId),
      )
    ) {
      throw new Error('LLM_UNKNOWN_KNOWLEDGE_POINT')
    }
    if (
      new Set(parsed.questions.map((question) => question.stem)).size !==
      parsed.questions.length
    ) {
      throw new Error('LLM_DUPLICATE_QUESTIONS')
    }
    if (
      parsed.questions.some(
        (question, index) => question.questionType !== questionTypes[index],
      )
    ) {
      throw new Error('LLM_QUESTION_TYPE_MISMATCH')
    }

    const questionIds: string[] = []
    for (const question of parsed.questions) {
      const stored = await this.contentRepository.createQuestion(input.familyId, {
        ...question,
        status: 'published',
      })
      questionIds.push(stored.id)
    }

    const timestamp = new Date().toISOString()
    const assessment: Assessment = {
      id: randomUUID(),
      familyId: input.familyId,
      kidId: input.kidId,
      trigger: input.trigger,
      deliveryMode: input.deliveryMode,
      selectionMode: input.selectionMode,
      purpose: input.purpose,
      knowledgePointIds: [...requestedIds],
      questionIds,
      evidenceSummary: evidence,
      status: 'assigned',
      createdBy: input.createdBy,
      createdAt: timestamp,
      assignedAt: timestamp,
    }
    await this.assessmentRepository.save(assessment)
    return assessment
  }

  private async eventsForKid(
    familyId: string,
    kidId: string,
  ): Promise<StoredLearningEvent[]> {
    return (await this.eventRepository.listForFamily(familyId)).filter(
      (event) => event.actorId === kidId,
    )
  }
}

export class OpenAiCompatibleQuestionGenerator implements QuestionGenerator {
  constructor(private readonly router: ModelRouter) {}

  isConfigured(familyId: string): boolean {
    return this.router.isConfigured(familyId, 'chat')
  }

  async generate(input: {
    familyId: string
    trigger: AssessmentTrigger
    purpose: string
    count: number
    deliveryMode: AssessmentDeliveryMode
    questionTypes: QuestionType[]
    knowledgePoints: KnowledgePoint[]
    evidence: AssessmentEvidence[]
  }): Promise<GeneratedQuestion[]> {
    let validationFeedback: string[] = []
    let lastSchemaError: z.ZodError | undefined
    let lastBusinessError = 'LLM_INVALID_QUESTION'

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await this.router.chatJson<unknown>(input.familyId, {
        temperature: 0.2,
        maxRetries: 0,
        timeoutMs: 60_000,
        messages: [
          {
            role: 'system',
            content: [
              '你是初中数学考察题生成器。',
              '只依据给定知识点及教材摘要出题，严格输出 JSON。',
              '题目必须能检验目标知识点，不得超纲或产生歧义。',
              '所有题目必须达到同年级同知识范围题目中难度前 30%，difficulty 只能是 4 或 5。',
              'single_choice 必须是 A/B/C/D 四选一且只有一个正确答案。',
              'subjective 必须是需要写出推理、证明或综合解答过程的大题，options 必须为空数组，answerKey 填写完整参考答案。',
              '严格按 questionTypes 给出的顺序生成题型，不得自行更换题型。',
              'L1/L2/L3 提示应逐步启发，禁止泄露正确选项、答案文本或完整解题过程。',
              '客观题必须为 A/B/C/D 每个选项分别生成 L1/L2/L3 三级提示。',
              '主观题的 optionHints 也保留 A/B/C/D 四个键，每个键复制通用的三级提示以兼容存储。',
              '分选项提示要针对该选项暴露的思维误区，但不要直接说该选项对错，也不要写出正确选项。',
              'kpId 必须原样复制输入中的 UUID，不得填写知识点编码或名称。',
              '客观题 options 必须依次包含 A/B/C/D；difficulty 必须是 4 或 5。',
              'referenceSteps、scoringPoints、hints 必须是字符串数组，hints 必须恰好包含 3 项。',
              'optionHints 必须是包含 A/B/C/D 四个键的对象，每个值都必须是恰好 3 项的字符串数组。',
              'diagnosisProbes 必须按 A/B/C/D 分别给出 misconceptionCode 和 description，用于结构化记录该选项反映的误区。',
              '四个选项必须语义互斥，禁止重复文本、等价数值或多个同时正确的选项。',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              task: `生成 ${input.count} 道本次考察题`,
              trigger: input.trigger,
              deliveryMode: input.deliveryMode,
              difficultyBand: '同年级同知识范围内难度前 30%',
              questionTypes: input.questionTypes,
              purpose: input.purpose,
              knowledgePoints: input.knowledgePoints.map((item) => ({
                id: item.id,
                code: item.code,
                name: item.name,
                chapter: item.chapter,
                summary: item.summary,
                sourcePages: [item.sourcePageStart, item.sourcePageEnd],
                prerequisiteCodes: item.prerequisiteCodes,
              })),
              recentEvidence: input.evidence,
              outputSchema: {
                questions: [
                  {
                    kpId: '必须使用给定知识点 id',
                    stem: '题干',
                    questionType: 'single_choice 或 subjective',
                    options: [
                      { key: 'A', text: '选项' },
                      { key: 'B', text: '选项' },
                      { key: 'C', text: '选项' },
                      { key: 'D', text: '选项' },
                    ],
                    difficulty: 4,
                    answerKey: '客观题填 A/B/C/D；主观题填完整参考答案',
                    referenceSteps: ['服务端判题参考步骤'],
                    scoringPoints: ['评分点'],
                    hints: ['L1', 'L2', 'L3'],
                    optionHints: {
                      A: ['选择 A 后的 L1', '选择 A 后的 L2', '选择 A 后的 L3'],
                      B: ['选择 B 后的 L1', '选择 B 后的 L2', '选择 B 后的 L3'],
                      C: ['选择 C 后的 L1', '选择 C 后的 L2', '选择 C 后的 L3'],
                      D: ['选择 D 后的 L1', '选择 D 后的 L2', '选择 D 后的 L3'],
                    },
                    diagnosisProbes: {
                      A: {
                        misconceptionCode: '误区编码或 correct_reasoning',
                        description: '选择 A 反映的判断路径',
                      },
                      B: {
                        misconceptionCode: '误区编码',
                        description: '选择 B 反映的判断路径',
                      },
                      C: {
                        misconceptionCode: '误区编码',
                        description: '选择 C 反映的判断路径',
                      },
                      D: {
                        misconceptionCode: '误区编码',
                        description: '选择 D 反映的判断路径',
                      },
                    },
                  },
                ],
              },
              ...(validationFeedback.length
                ? {
                    previousAttemptProblems: validationFeedback,
                    correction:
                      '上一次输出未通过服务端校验。请重新生成完整 JSON，不要只解释或局部修补。',
                  }
                : {}),
            }),
          },
        ],
      })
      const normalized = normalizeGeneratedAssessment(
        result.data,
        input.knowledgePoints,
      )
      const parsed = generatedAssessmentSchema.safeParse(normalized)
      if (!parsed.success) {
        lastSchemaError = parsed.error
        lastBusinessError = 'LLM_INVALID_QUESTION'
        validationFeedback = parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
        )
        continue
      }

      validationFeedback = []
      if (parsed.data.questions.length !== input.count) {
        lastBusinessError = 'LLM_QUESTION_COUNT_MISMATCH'
        validationFeedback.push(
          `questions: 必须生成 ${input.count} 道题，实际生成 ${parsed.data.questions.length} 道`,
        )
      }
      const allowedIds = new Set(input.knowledgePoints.map((item) => item.id))
      if (
        parsed.data.questions.some(
          (question) => !allowedIds.has(question.kpId),
        )
      ) {
        lastBusinessError = 'LLM_UNKNOWN_KNOWLEDGE_POINT'
        validationFeedback.push('questions.kpId: 只能使用输入中给定的 UUID')
      }
      if (
        new Set(parsed.data.questions.map((question) => question.stem)).size !==
        parsed.data.questions.length
      ) {
        lastBusinessError = 'LLM_DUPLICATE_QUESTIONS'
        validationFeedback.push('questions.stem: 每道题的题干必须不同')
      }
      if (
        parsed.data.questions.some(
          (question, index) =>
            question.questionType !== input.questionTypes[index],
        )
      ) {
        lastBusinessError = 'LLM_QUESTION_TYPE_MISMATCH'
        validationFeedback.push(
          `questions.questionType: 必须依次为 ${input.questionTypes.join(', ')}`,
        )
      }
      if (!validationFeedback.length) return parsed.data.questions
      lastSchemaError = undefined
    }

    if (lastSchemaError) throw lastSchemaError
    throw new Error(lastBusinessError)
  }
}

const optionKeys = ['A', 'B', 'C', 'D'] as const

function normalizeGeneratedAssessment(
  value: unknown,
  knowledgePoints: KnowledgePoint[],
): unknown {
  if (Array.isArray(value)) {
    return {
      questions: value.map((question) =>
        normalizeGeneratedQuestion(question, knowledgePoints),
      ),
    }
  }

  const root = asRecord(value)
  if (!root) return value
  const nested =
    asRecord(root.data) ??
    asRecord(root.result) ??
    asRecord(root.output) ??
    root
  const rawQuestions =
    nested.questions ??
    nested.questionList ??
    nested.items ??
    (nested.question ? [nested.question] : undefined)

  return {
    ...nested,
    questions: Array.isArray(rawQuestions)
      ? rawQuestions.map((question) =>
          normalizeGeneratedQuestion(question, knowledgePoints),
        )
      : rawQuestions,
  }
}

function normalizeGeneratedQuestion(
  value: unknown,
  knowledgePoints: KnowledgePoint[],
): unknown {
  const question = asRecord(value)
  if (!question) return value

  const rawOptions =
    question.options ?? question.choices ?? question.optionList
  const options = normalizeOptions(rawOptions)
  const rawKnowledgePoint =
    question.kpId ??
    question.knowledgePointId ??
    question.knowledge_point_id ??
    question.kpCode
  const hints = normalizeHints(
    question.hints ?? question.hintLevels ?? question.hint_levels,
  )
  const questionType = normalizeQuestionType(
    question.questionType ?? question.type ?? question.question_type,
    rawOptions,
  )

  return {
    ...question,
    kpId: normalizeKnowledgePointId(rawKnowledgePoint, knowledgePoints),
    stem:
      question.stem ??
      question.question ??
      question.questionText ??
      question.content,
    questionType,
    options: questionType === 'subjective' ? [] : options,
    difficulty: normalizeDifficulty(
      question.difficulty ?? question.difficultyLevel,
    ),
    answerKey:
      questionType === 'subjective'
        ? String(
            question.answerKey ??
              question.referenceAnswer ??
              question.reference_answer ??
              question.correctAnswer ??
              question.answer ??
              '',
          ).trim()
        : normalizeAnswerKey(
            question.answerKey ??
              question.correctAnswer ??
              question.answer ??
              question.correct_option,
            rawOptions,
            options,
          ),
    referenceSteps: normalizeStringList(
      question.referenceSteps ??
        question.reference_steps ??
        question.solutionSteps ??
        question.solution,
    ),
    scoringPoints: normalizeStringList(
      question.scoringPoints ??
        question.scoring_points ??
        question.scorePoints,
    ),
    hints,
    optionHints: normalizeOptionHints(
      question.optionHints ??
        question.option_hints ??
        question.hintsByOption ??
        question.hints_by_option,
      hints,
    ),
    diagnosisProbes: normalizeDiagnosisProbes(
      question.diagnosisProbes ??
        question.diagnosis_probes ??
        question.optionDiagnosis,
      question.answerKey ?? question.correctAnswer ?? question.answer,
    ),
  }
}

function normalizeQuestionType(
  value: unknown,
  rawOptions: unknown,
): QuestionType {
  const candidate = String(value ?? '').trim().toLowerCase()
  if (
    candidate === 'subjective' ||
    candidate === '主观题' ||
    candidate === '解答题' ||
    candidate === '证明题'
  ) {
    return 'subjective'
  }
  if (
    candidate === 'single_choice' ||
    candidate === 'objective' ||
    candidate === '选择题'
  ) {
    return 'single_choice'
  }
  return Array.isArray(rawOptions) && rawOptions.length
    ? 'single_choice'
    : 'subjective'
}

function normalizeKnowledgePointId(
  value: unknown,
  knowledgePoints: KnowledgePoint[],
): unknown {
  const record = asRecord(value)
  const candidate = String(
    record?.id ?? record?.code ?? record?.name ?? value ?? '',
  ).trim()
  const matched = knowledgePoints.find(
    (item) =>
      item.id === candidate ||
      item.code === candidate ||
      item.name === candidate,
  )
  if (matched) return matched.id
  if (!candidate && knowledgePoints.length === 1) return knowledgePoints[0]!.id
  return candidate
}

function normalizeOptions(value: unknown): unknown {
  const entries = Array.isArray(value)
    ? value
    : Object.entries(asRecord(value) ?? {}).map(([key, text]) => ({
        key,
        text,
      }))
  if (!entries.length) return value

  return entries.map((entry, index) => {
    const record = asRecord(entry)
    return {
      key: optionKeys[index] ?? String(record?.key ?? ''),
      text:
        typeof entry === 'string'
          ? entry
          : record?.text ??
            record?.content ??
            record?.value ??
            record?.label,
    }
  })
}

function normalizeAnswerKey(
  value: unknown,
  rawOptions: unknown,
  normalizedOptions: unknown,
): unknown {
  const candidate = String(value ?? '').trim()
  const letter = candidate.toUpperCase().match(/[ABCD]/)?.[0]
  const rawEntries = Array.isArray(rawOptions)
    ? rawOptions
    : Object.entries(asRecord(rawOptions) ?? {}).map(([key, text]) => ({
        key,
        text,
      }))

  if (letter) {
    const originalIndex = rawEntries.findIndex((entry) => {
      const record = asRecord(entry)
      const key = String(record?.key ?? record?.label ?? '').toUpperCase()
      return key.match(/[ABCD]/)?.[0] === letter
    })
    return originalIndex >= 0 ? optionKeys[originalIndex] : letter
  }

  if (/^[1-4]$/.test(candidate)) {
    return optionKeys[Number(candidate) - 1]
  }
  if (Array.isArray(normalizedOptions)) {
    const answerIndex = normalizedOptions.findIndex((option) => {
      const record = asRecord(option)
      return String(record?.text ?? '').trim() === candidate
    })
    if (answerIndex >= 0) return optionKeys[answerIndex]
  }
  return value
}

function normalizeDifficulty(value: unknown): unknown {
  if (typeof value === 'number') return value
  const candidate = String(value ?? '').trim()
  const numeric = Number(candidate)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) return numeric
  const labels: Record<string, number> = {
    容易: 1,
    简单: 1,
    较易: 2,
    中等: 3,
    较难: 4,
    困难: 5,
  }
  return labels[candidate] ?? value
}

function normalizeStringList(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const record = asRecord(item)
      return String(record?.text ?? record?.content ?? item).trim()
    })
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return value
}

function normalizeHints(value: unknown): unknown {
  if (Array.isArray(value)) return normalizeStringList(value)
  const record = asRecord(value)
  if (record) {
    const hints = [
      record.L1 ?? record.l1 ?? record.level1,
      record.L2 ?? record.l2 ?? record.level2,
      record.L3 ?? record.l3 ?? record.level3,
    ]
    if (hints.every((hint) => typeof hint === 'string')) {
      return hints.map((hint) => String(hint).trim())
    }
  }
  if (typeof value === 'string') {
    const lines = value
      .split(/\n+/)
      .map((line) => line.replace(/^(?:L[123]|[123])[.、:：\s-]*/i, '').trim())
      .filter(Boolean)
    if (lines.length === 3) return lines
  }
  return value
}

function normalizeOptionHints(
  value: unknown,
  fallbackHints: unknown,
): unknown {
  const record = asRecord(value)
  if (record) {
    return Object.fromEntries(
      optionKeys.map((key) => [key, normalizeHints(record[key])]),
    )
  }
  if (Array.isArray(value) && value.every((item) => asRecord(item))) {
    const byKey = new Map(
      value.map((item, index) => {
        const entry = asRecord(item)!
        const key = String(entry.key ?? entry.option ?? optionKeys[index])
          .trim()
          .toUpperCase()
        return [
          key,
          normalizeHints(entry.hints ?? entry.levels ?? entry.hintLevels),
        ]
      }),
    )
    return Object.fromEntries(
      optionKeys.map((key) => [key, byKey.get(key)]),
    )
  }
  if (Array.isArray(fallbackHints) && fallbackHints.length === 3) {
    return Object.fromEntries(
      optionKeys.map((key) => [key, [...fallbackHints]]),
    )
  }
  return value
}

function normalizeDiagnosisProbes(
  value: unknown,
  answerKey: unknown,
): unknown {
  const record = asRecord(value)
  const normalizedAnswer = String(answerKey ?? '')
    .toUpperCase()
    .match(/[ABCD]/)?.[0]
  return Object.fromEntries(
    optionKeys.map((key) => {
      const item = asRecord(record?.[key])
      return [
        key,
        {
          misconceptionCode: String(
            item?.misconceptionCode ??
              item?.code ??
              (key === normalizedAnswer
                ? 'correct_reasoning'
                : `option_${key.toLowerCase()}`),
          ).trim(),
          description: String(
            item?.description ??
              item?.reason ??
              (key === normalizedAnswer
                ? '正确应用目标知识点。'
                : `选择 ${key} 时需要复查目标知识点的适用条件。`),
          ).trim(),
        },
      ]
    }),
  )
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。；：、,.!?！？;:'"“”‘’()（）[\]{}]/g, '')
}

function numericValue(value: string): number | undefined {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, '')
  const percent = normalized.match(/^([+-]?\d+(?:\.\d+)?)%$/)
  if (percent) return Number(percent[1]) / 100
  const fraction = normalized.match(/^([+-]?\d+)\/([+-]?\d+)$/)
  if (fraction && Number(fraction[2]) !== 0) {
    return Number(fraction[1]) / Number(fraction[2])
  }
  return /^[+-]?\d+(?:\.\d+)?$/.test(normalized)
    ? Number(normalized)
    : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function toEvidence(event: StoredLearningEvent): AssessmentEvidence {
  return {
    type: event.type,
    occurredAt: event.createdAtLocal,
    kpIds: event.kpIds,
  }
}

function questionTypesFor(
  deliveryMode: AssessmentDeliveryMode,
  count: number,
): QuestionType[] {
  if (deliveryMode === 'passport') {
    return Array.from({ length: count }, () => 'single_choice')
  }
  const objectiveCount = count <= 1 ? 0 : Math.max(1, Math.floor(count * 0.3))
  return Array.from({ length: count }, (_, index) =>
    index < objectiveCount ? 'single_choice' : 'subjective',
  )
}
