export interface SessionUser {
  id: string
  role: 'parent' | 'child'
  kidId?: string
}

export interface TrainingQuestion {
  id: string
  kpId: string
  stem: string
  options: Array<{ key: string; text: string }>
  questionType: 'single_choice' | 'subjective'
  difficulty: 1 | 2 | 3 | 4 | 5
}

export interface TodayTraining {
  planId: string
  sessionId?: string
  localDate: string
  title: string
  estimatedMinutes: number
  stopAddingAtMinutes: number
  closeAtMinutes: number
  budget: TrainingBudget
  activeAttempt?: {
    attemptId: string
    questionId: string
    hintLevel: 0 | 1 | 2 | 3
  }
  questions: TrainingQuestion[]
}

export interface TrainingBudget {
  serverStartedAt: string | null
  elapsedSeconds: number
  remainingSeconds: number
  stopAddingQuestions: boolean
  sessionClosed: boolean
}

export type ContentStatus = 'draft' | 'published'

export interface KnowledgePoint {
  id: string
  code: string
  name: string
  chapter: string
  summary: string
  sourcePageStart?: number
  sourcePageEnd?: number
  prerequisiteCodes: string[]
  status: ContentStatus
}

export interface ContentSnapshot {
  knowledgePoints: KnowledgePoint[]
  assessmentConfigured: boolean
}

export interface TextbookImport {
  id: string
  fileName: string
  pageCount: number
  extractedCharacters: number
  status: 'ready_for_review' | 'confirmed'
  createdAt: string
  confirmedAt?: string
  draft: {
    title: string
    subject: '数学'
    grade: string
    edition: string
    chapters: Array<{
      code: string
      title: string
      pageStart: number
      pageEnd: number
      knowledgePoints: Array<{
        code: string
        name: string
        summary: string
        pageStart: number
        pageEnd: number
        prerequisiteCodes: string[]
      }>
    }>
  }
}

export interface TextbookAnalysisProgress {
  jobId: string
  fileName: string
  status: 'extracting' | 'analyzing' | 'saving' | 'completed' | 'failed'
  percent: number
  message: string
  completedChunks: number
  totalChunks: number
  startedAt: string
  updatedAt: string
}

export interface Assessment {
  id: string
  trigger: 'routine' | 'parent_initiated'
  deliveryMode: 'passport' | 'weekend_paper'
  selectionMode: 'manual' | 'auto_core'
  purpose: string
  knowledgePointIds: string[]
  questionIds: string[]
  status: 'assigned'
  createdAt: string
  assignedAt: string
}

export type ModelCapability = 'chat' | 'embedding' | 'vision'

export interface ModelCapabilityConfig {
  capability: ModelCapability
  enabled: boolean
  configured: boolean
  primary: {
    baseUrl: string
    model: string
    apiKeyMasked: string
    hasApiKey: boolean
  }
  fallback?: {
    baseUrl: string
    model: string
    apiKeyMasked: string
    hasApiKey: boolean
  }
  retryCount: number
  timeoutMs: number
  updatedAt?: string
}

export interface ModelConfigs {
  capabilities: ModelCapabilityConfig[]
  usage: Record<ModelCapability, string[]>
}

export type MasteryStatus = 'insufficient' | 'weak' | 'basic' | 'mastered'
export type ReviewDecision = 'agree' | 'disagree' | 'unsure'

export interface MasteryProjection {
  projectionId: string
  projectionVersion: number
  modelVersion: string
  kpId: string
  knowledgePointName: string
  chapter: string
  status: MasteryStatus
  score: number | null
  sampleCount: number
  independentCount: number
  independentCorrectCount: number
  spacedDayCount: number
  evidenceFrom: string
  evidenceTo: string
  calculationDetails: {
    accuracy: number
    hintDependence: number
    averageHintLevel: number
    stability: number
    speed: number
    averageDurationMs: number | null
    latestIndependentCorrect: boolean
    insufficiencyReasons: string[]
  }
  needsReview: boolean
  review?: {
    decision: ReviewDecision
    note?: string
    projectionVersion: number
    current: boolean
    createdAt: string
  }
}

export interface MasterySnapshot {
  modelVersion: string
  summary: {
    mastered: number
    hintDependent: number
    needsReview: number
    insufficient: number
  }
  projections: MasteryProjection[]
}

export type WrongItemStatus = 'active' | 'mastered' | 'archived'

export interface WrongItem {
  id: string
  source: 'system' | 'photo'
  questionId?: string
  kpId?: string
  knowledgePointName?: string
  chapter?: string
  stem: string
  studentAnswer?: string
  answerKey?: string
  analysis?: string
  hasPhoto: boolean
  photoUrl?: string
  mappingConfidence?: number
  mappingMethod: 'question' | 'vision' | 'manual'
  mappingConfirmed: boolean
  status: WrongItemStatus
  tags: string[]
  note: string
  wrongCount: number
  reviewCount: number
  correctReviewStreak: number
  firstWrongAt: string
  latestWrongAt: string
  nextReviewAt?: string
}

export interface WrongBookSnapshot {
  photoRecognitionConfigured: boolean
  items: WrongItem[]
}

export type LearningTaskStatus =
  | 'pending'
  | 'claimed_done'
  | 'verified'
  | 'cancelled'

export interface LearningTask {
  id: string
  source: 'parent' | 'school' | 'system'
  kind: 'homework' | 'preview' | 'review' | 'carry_reminder' | 'practice'
  title: string
  description: string
  subject: string
  kpId?: string
  dueAt?: string
  estimatedMinutes: number
  priority: 1 | 2 | 3
  status: LearningTaskStatus
  claimedDoneAt?: string
  verifiedAt?: string
}

export interface TaskSnapshot {
  tasks: LearningTask[]
  workload: {
    plannedMinutes: number
    overdueCount: number
    recommendedMinutes: number
    reduced: boolean
  }
}

export interface CurriculumProgress {
  id: string
  subject: string
  chapter: string
  kpId?: string
  source: 'parent' | 'schedule_ocr' | 'school_task_ocr' | 'system'
  confidence: number
  mappingStatus: 'mapped' | 'unmapped' | 'confirmed'
  effectiveDate: string
}

export interface WeeklyReport {
  generatedAt: string
  period: { from: string; to: string }
  overview: {
    attempts: number
    independentAttempts: number
    accuracy: number | null
    mastered: number
    needsReview: number
  }
  trend: {
    previousAccuracy: number | null
    change: number | null
    direction: 'up' | 'down' | 'flat' | 'insufficient'
  }
  focus: Array<{
    kpId: string
    name: string
    status: MasteryStatus
    score: number | null
    hintDependence: number
  }>
  suggestions: string[]
}

export type WordbookSourceType = 'pdf' | 'docx' | 'text'

export interface WordDraftEntry {
  word: string
  phonetic: string
  partOfSpeech: string
  meaning: string
}

export interface Wordbook {
  id: string
  name: string
  fileName: string
  sourceType: WordbookSourceType
  status: 'ready_for_review' | 'confirmed'
  /** 列表接口不返回词条明细 */
  entries?: WordDraftEntry[]
  entryCount: number
  createdAt: string
  confirmedAt?: string
}

export type WordQuizDirection = 'en_to_zh' | 'zh_to_en'

export interface WordQuiz {
  id: string
  kidId: string
  wordbookId: string
  direction: WordQuizDirection
  deliveryMode: 'passport' | 'web'
  questionCount: number
  status: 'assigned' | 'completed'
  assignedLocalDate: string
  createdAt: string
  completedAt?: string
}

export interface WordQuizQuestion {
  id: string
  position: number
  stem: string
  options: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string }>
  /** 仅 passport（随身设备）模式返回，供设备离线判题 */
  answerKey?: 'A' | 'B' | 'C' | 'D'
}

export interface WordStats {
  totalAnswers: number
  correctAnswers: number
  accuracy: number
  byDirection: Record<
    WordQuizDirection,
    { totalAnswers: number; correctAnswers: number; accuracy: number }
  >
  wrongItems: { active: number; mastered: number }
}

export type WordWrongItemStatus = 'active' | 'mastered'

export interface WordWrongItem {
  id: string
  entryId: string
  wordbookId: string
  word: string
  phonetic: string
  meaning: string
  wrongCount: number
  correctStreak: number
  status: WordWrongItemStatus
  lastWrongAt: string
  masteredAt?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryable = retryable
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (
    init?.body !== undefined &&
    !(init.body instanceof FormData) &&
    !headers.has('content-type')
  ) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string
      retryable?: boolean
    } | null
    throw new ApiError(
      body?.message || `请求失败（${response.status}）`,
      response.status,
      body?.retryable ?? (response.status >= 500 || response.status === 429),
    )
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function login(
  role: 'parent' | 'child',
  credential: string,
): Promise<SessionUser> {
  const result = await api<{ user: SessionUser }>('/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ role, credential }),
  })
  return result.user
}

export async function getSession(): Promise<SessionUser> {
  const result = await api<{ user: SessionUser }>('/v1/session')
  return result.user
}

export function logout(): Promise<void> {
  return api('/v1/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export function getTodayTraining(): Promise<TodayTraining> {
  return api('/v1/training/today')
}

export function getMastery(): Promise<MasterySnapshot> {
  return api('/v1/mastery')
}

export function getTasks(): Promise<TaskSnapshot> {
  return api('/v1/tasks')
}

export async function createTask(input: {
  source: 'parent' | 'school'
  kind: LearningTask['kind']
  title: string
  description: string
  subject: string
  kpId?: string
  dueAt?: string
  estimatedMinutes: number
  priority: 1 | 2 | 3
}): Promise<LearningTask> {
  const result = await api<{ task: LearningTask }>('/v1/tasks', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.task
}

export async function changeTaskStatus(
  id: string,
  status: LearningTaskStatus,
): Promise<LearningTask> {
  const result = await api<{ task: LearningTask }>(
    `/v1/tasks/${id}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
  )
  return result.task
}

export async function getCurriculumProgress(): Promise<CurriculumProgress[]> {
  const result = await api<{ progress: CurriculumProgress[] }>(
    '/v1/curriculum-progress',
  )
  return result.progress
}

export async function createCurriculumProgress(input: {
  subject: string
  chapter: string
  kpId?: string
  source: 'parent' | 'schedule_ocr' | 'school_task_ocr'
  confidence: number
  effectiveDate: string
}): Promise<CurriculumProgress> {
  const result = await api<{ progress: CurriculumProgress }>(
    '/v1/curriculum-progress',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
  return result.progress
}

export async function confirmCurriculumProgress(
  id: string,
  kpId: string,
): Promise<CurriculumProgress> {
  const result = await api<{ progress: CurriculumProgress }>(
    `/v1/curriculum-progress/${id}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ kpId }),
    },
  )
  return result.progress
}

export function getWeeklyReport(): Promise<WeeklyReport> {
  return api('/v1/reports/weekly')
}

export function getWrongItems(
  status?: WrongItemStatus,
): Promise<WrongBookSnapshot> {
  return api(`/v1/wrong-items${status ? `?status=${status}` : ''}`)
}

export async function uploadWrongItemPhoto(file: File): Promise<WrongItem> {
  const body = new FormData()
  body.append('file', file)
  const result = await api<{ item: WrongItem }>('/v1/wrong-items/photo', {
    method: 'POST',
    body,
  })
  return result.item
}

export async function updateWrongItem(
  id: string,
  input: {
    status?: WrongItemStatus
    kpId?: string
    tags?: string[]
    note?: string
  },
): Promise<WrongItem> {
  const result = await api<{ item: WrongItem }>(`/v1/wrong-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return result.item
}

export function deleteWrongItem(id: string): Promise<void> {
  return api(`/v1/wrong-items/${id}`, { method: 'DELETE' })
}

export function reviewWrongItem(
  id: string,
  result: 'correct' | 'incorrect',
): Promise<void> {
  return api(`/v1/wrong-items/${id}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  })
}

export async function submitMasteryReview(
  kpId: string,
  input: {
    projectionVersion: number
    decision: ReviewDecision
    note?: string
  },
): Promise<void> {
  await api(`/v1/mastery/${kpId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function startTrainingAttempt(input: {
  attemptId: string
  questionId: string
}): Promise<{ attemptId: string; budget: TrainingBudget }> {
  return api('/v1/training/attempts/start', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getContent(): Promise<ContentSnapshot> {
  return api('/v1/content')
}

export function getModelConfigs(): Promise<ModelConfigs> {
  return api('/v1/model-configs')
}

export async function saveModelConfig(
  capability: ModelCapability,
  input: {
    enabled: boolean
    primary: { baseUrl: string; model: string; apiKey?: string }
    fallback?: { baseUrl: string; model: string; apiKey?: string }
    retryCount: number
    timeoutMs: number
  },
): Promise<ModelCapabilityConfig> {
  const result = await api<{ capability: ModelCapabilityConfig }>(
    `/v1/model-configs/${capability}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  )
  return result.capability
}

export async function fetchModelOptions(
  capability: ModelCapability,
  input: {
    target: 'primary' | 'fallback'
    baseUrl: string
    apiKey?: string
  },
): Promise<string[]> {
  const result = await api<{ models: string[] }>(
    `/v1/model-configs/${capability}/models`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
  return result.models
}

export async function getAssessments(): Promise<{
  configured: boolean
  assessments: Assessment[]
}> {
  return api('/v1/assessments')
}

export async function createAssessment(input: {
  knowledgePointIds: string[]
  purpose: string
  count: number
  deliveryMode: 'passport' | 'weekend_paper'
  selectionMode: 'manual' | 'auto_core'
}): Promise<Assessment> {
  const result = await api<{ assessment: Assessment }>('/v1/assessments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.assessment
}

export async function getAssessmentRecommendations(
  count = 6,
): Promise<Array<{ id: string; score: number; reasons: string[] }>> {
  const result = await api<{
    recommendations: Array<{ id: string; score: number; reasons: string[] }>
  }>(`/v1/assessments/recommendations?count=${count}`)
  return result.recommendations
}

export async function createRoutineAssessment(count = 3): Promise<Assessment> {
  const result = await api<{ assessment: Assessment }>(
    '/v1/assessments/routine',
    {
      method: 'POST',
      body: JSON.stringify({ count }),
    },
  )
  return result.assessment
}

export async function getTextbookImports(): Promise<{
  configured: boolean
  requiredCapability: 'chat'
  imports: TextbookImport[]
}> {
  return api('/v1/textbooks')
}

export async function getTextbookProgress(): Promise<TextbookAnalysisProgress | null> {
  const result = await api<{ progress: TextbookAnalysisProgress | null }>(
    '/v1/textbooks/progress',
  )
  return result.progress
}

export async function uploadTextbook(file: File): Promise<TextbookImport> {
  const body = new FormData()
  body.append('file', file)
  const result = await api<{ textbookImport: TextbookImport }>(
    '/v1/textbooks/upload',
    {
      method: 'POST',
      body,
    },
  )
  return result.textbookImport
}

export async function confirmTextbookImport(id: string): Promise<TextbookImport> {
  const result = await api<{ textbookImport: TextbookImport }>(
    `/v1/textbooks/${id}/validate`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
  return result.textbookImport
}

export function checkAnswer(input: {
  submissionId: string
  attemptId: string
  questionId: string
  answer: string
}): Promise<{
  correct: boolean
  nextAction: 'continue' | 'try_again'
  score?: number
  feedback?: string
  budget: TrainingBudget
}> {
  return api('/v1/answers/check', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function requestHint(input: {
  attemptId: string
  questionId: string
  selectedAnswer: 'A' | 'B' | 'C' | 'D'
  kidInput: string
}): Promise<{
  attemptId: string
  guideAttemptId: string
  text: string
  hintLevel: 1 | 2 | 3
  safetyResult: 'pass' | 'blocked_regenerated' | 'blocked_fallback'
  policyVersion: string
}> {
  return api('/v1/guide', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listWordbooks(): Promise<Wordbook[]> {
  const result = await api<{ wordbooks: Wordbook[] }>('/v1/wordbooks')
  return result.wordbooks
}

export async function uploadWordbook(file: File): Promise<Wordbook> {
  const body = new FormData()
  body.append('file', file)
  const result = await api<{ wordbook: Wordbook }>('/v1/wordbooks/upload', {
    method: 'POST',
    body,
  })
  return result.wordbook
}

export async function confirmWordbook(id: string): Promise<Wordbook> {
  const result = await api<{ wordbook: Wordbook }>(
    `/v1/wordbooks/${id}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  )
  return result.wordbook
}

export function deleteWordbook(id: string): Promise<void> {
  return api(`/v1/wordbooks/${id}`, { method: 'DELETE' })
}

export async function createWordQuiz(input: {
  wordbookId: string
  direction: WordQuizDirection
  count: number
  deliveryMode: 'passport' | 'web'
}): Promise<{ quiz: WordQuiz; questionCount: number }> {
  return api('/v1/word-quizzes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listWordQuizzes(limit = 10): Promise<WordQuiz[]> {
  const result = await api<{ quizzes: WordQuiz[] }>(
    `/v1/word-quizzes?limit=${limit}`,
  )
  return result.quizzes
}

export function getWordQuiz(id: string): Promise<{
  quiz: WordQuiz
  questions: WordQuizQuestion[]
}> {
  return api(`/v1/word-quizzes/${id}`)
}

export function submitWordAnswers(
  quizId: string,
  answers: Array<{ questionId: string; selectedKey: 'A' | 'B' | 'C' | 'D' }>,
): Promise<{
  accepted: string[]
  duplicated: string[]
  results: Array<{ questionId: string; isCorrect: boolean; answerKey: string }>
}> {
  return api(`/v1/word-quizzes/${quizId}/answers`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  })
}

export function getWordStats(): Promise<WordStats> {
  return api('/v1/word-stats')
}

export async function getWordWrongItems(
  status?: WordWrongItemStatus,
): Promise<WordWrongItem[]> {
  const result = await api<{ items: WordWrongItem[] }>(
    `/v1/word-wrong-items${status ? `?status=${status}` : ''}`,
  )
  return result.items
}

export function updateWordWrongItem(
  id: string,
  status: WordWrongItemStatus,
): Promise<{ ok: true }> {
  return api(`/v1/word-wrong-items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}
