export type ContentStatus = 'draft' | 'published'

export interface KnowledgePoint {
  id: string
  familyId: string
  code: string
  name: string
  chapter: string
  summary: string
  sourcePageStart?: number
  sourcePageEnd?: number
  prerequisiteCodes: string[]
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export interface QuestionOption {
  key: string
  text: string
}

export type QuestionType = 'single_choice' | 'subjective'
export type HintTuple = [string, string, string]
export type OptionHints = Record<'A' | 'B' | 'C' | 'D', HintTuple>
export interface DiagnosisProbe {
  misconceptionCode: string
  description: string
}
export type DiagnosisProbes = Record<
  'A' | 'B' | 'C' | 'D',
  DiagnosisProbe
>

export interface QuestionPublic {
  id: string
  familyId: string
  kpId: string
  knowledgePointName: string
  stem: string
  options: QuestionOption[]
  questionType: QuestionType
  difficulty: 1 | 2 | 3 | 4 | 5
  status: ContentStatus
  createdAt: string
  updatedAt: string
}

export interface QuestionPrivate {
  questionId: string
  familyId: string
  answerKey: string
  referenceSteps: string[]
  scoringPoints: string[]
  hints: HintTuple
  optionHints: OptionHints
  diagnosisProbes: DiagnosisProbes
}

export interface QuestionForParent extends QuestionPublic {
  knowledgePointName: string
  answerKey: string
  referenceSteps: string[]
  scoringPoints: string[]
  hints: HintTuple
  optionHints: OptionHints
  diagnosisProbes: DiagnosisProbes
}

export interface CreateKnowledgePointInput {
  code: string
  name: string
  chapter: string
  summary?: string
  sourcePageStart?: number
  sourcePageEnd?: number
  prerequisiteCodes?: string[]
  status: ContentStatus
}

export interface CreateQuestionInput {
  kpId: string
  stem: string
  options: QuestionOption[]
  questionType: QuestionType
  difficulty: 1 | 2 | 3 | 4 | 5
  status: ContentStatus
  answerKey: string
  referenceSteps: string[]
  scoringPoints: string[]
  hints: HintTuple
  optionHints: OptionHints
  diagnosisProbes: DiagnosisProbes
}

export interface QuestionPublicRepository {
  listPublishedQuestionsByIds(
    familyId: string,
    questionIds: string[],
  ): Promise<QuestionPublic[]>
  findPublishedQuestion(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPublic | undefined>
}

export interface QuestionPrivateRepository {
  findQuestionPrivate(
    familyId: string,
    questionId: string,
  ): Promise<QuestionPrivate | undefined>
}

export interface ContentRepository
  extends QuestionPublicRepository,
    QuestionPrivateRepository {
  listKnowledgePoints(familyId: string): Promise<KnowledgePoint[]>
  createKnowledgePoint(
    familyId: string,
    input: CreateKnowledgePointInput,
  ): Promise<KnowledgePoint>
  setKnowledgePointStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<KnowledgePoint | undefined>
  listQuestionsForParent(familyId: string): Promise<QuestionForParent[]>
  createQuestion(
    familyId: string,
    input: CreateQuestionInput,
  ): Promise<QuestionForParent>
  setQuestionStatus(
    familyId: string,
    id: string,
    status: ContentStatus,
  ): Promise<QuestionForParent | undefined>
  close(): Promise<void>
}

export function compareKnowledgePointsByPage(
  left: KnowledgePoint,
  right: KnowledgePoint,
): number {
  return (
    compareOptionalPage(left.sourcePageStart, right.sourcePageStart) ||
    compareOptionalPage(left.sourcePageEnd, right.sourcePageEnd) ||
    left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
    left.name.localeCompare(right.name, 'zh-CN')
  )
}

function compareOptionalPage(
  left: number | undefined,
  right: number | undefined,
): number {
  if (left === undefined) return right === undefined ? 0 : 1
  if (right === undefined) return -1
  return left - right
}
