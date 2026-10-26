<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Archive,
  ArrowRight,
  BookMarked,
  BookOpen,
  Camera,
  CalendarDays,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Cloud,
  CloudOff,
  Database,
  Eye,
  FileText,
  GitBranch,
  Languages,
  Lightbulb,
  ListTodo,
  LogOut,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  TimerReset,
  Trash2,
  Upload,
  UserRound,
  X,
} from '@lucide/vue'
import {
  ApiError,
  checkAnswer,
  changeTaskStatus,
  confirmTextbookImport,
  confirmWordbook,
  confirmCurriculumProgress,
  createAssessment,
  createCurriculumProgress,
  createRoutineAssessment,
  createTask,
  createWordQuiz,
  deleteWordbook,
  deleteWrongItem,
  fetchModelOptions,
  getAssessmentRecommendations,
  getAssessments,
  getContent,
  getCurriculumProgress,
  getMastery,
  getModelConfigs,
  getSession,
  getTasks,
  getTextbookImports,
  getTextbookProgress,
  getTodayTraining,
  getWeeklyReport,
  getWordQuiz,
  getWordbook,
  getWordStats,
  getWordWrongItems,
  getWrongItems,
  listWordQuizzes,
  listWordbooks,
  login,
  logout,
  reviewWrongItem,
  requestHint,
  saveModelConfig,
  startTrainingAttempt,
  submitMasteryReview,
  submitWordAnswers,
  updateWordWrongItem,
  updateWordbook,
  updateWrongItem,
  uploadTextbook,
  uploadWordbook,
  uploadWrongItemPhoto,
  type Assessment,
  type ContentSnapshot,
  type CurriculumProgress,
  type KnowledgePoint,
  type LearningTask,
  type MasteryProjection,
  type MasterySnapshot,
  type ModelCapability,
  type ModelConfigs,
  type SessionUser,
  type TextbookAnalysisProgress,
  type TextbookImport,
  type TodayTraining,
  type TaskSnapshot,
  type WeeklyReport,
  type Wordbook,
  type WordQuiz,
  type WordQuizDirection,
  type WordQuizQuestion,
  type WordQuizProgress,
  type WordStats,
  type WordWrongItem,
  type WordWrongItemStatus,
  type WrongBookSnapshot,
  type WrongItem,
  type WrongItemStatus,
} from './api'
import {
  cacheChildWorkspace,
  clearCachedChildWorkspace,
  enqueueEvent,
  enqueuePendingAnswer,
  findPendingAnswer,
  getCachedChildWorkspace,
  pendingCount,
} from './offline/database'
import { syncOutbox, syncPendingAnswers } from './offline/sync'

const session = ref<SessionUser | null>(null)
const authReady = ref(false)
const role = ref<'child' | 'parent'>('child')
const credential = ref('')
const authError = ref('')
const loading = ref(false)

const training = ref<TodayTraining | null>(null)
const questionIndex = ref(0)
const selectedAnswer = ref('')
const feedback = ref<'idle' | 'correct' | 'wrong'>('idle')
const gradingFeedback = ref('')
const hint = ref<{ text: string; level: 1 | 2 | 3 } | null>(null)
const hintLoading = ref(false)
const attemptIds = ref<Record<string, string>>({})
const startedAt = ref(Date.now())
const elapsedSeconds = ref(0)
const syncCount = ref(0)
const syncActive = ref(false)
const actionError = ref('')
const pendingAnswerQuestionId = ref('')
const parentMode = ref<
  | 'assessment'
  | 'planning'
  | 'content'
  | 'wrongBook'
  | 'review'
  | 'models'
  | 'words'
>('assessment')
const childMode = ref<'training' | 'tasks' | 'wrongBook' | 'words'>('training')
const content = ref<ContentSnapshot | null>(null)
const contentLoading = ref(false)
const contentError = ref('')
const contentMessage = ref('')
const textbookImports = ref<TextbookImport[]>([])
const textbookChatConfigured = ref(false)
const selectedTextbook = ref<File | null>(null)
const importingTextbook = ref(false)
const textbookProgress = ref<TextbookAnalysisProgress | null>(null)
const textbookInput = ref<HTMLInputElement | null>(null)
const assessments = ref<Assessment[]>([])
const selectedKnowledgePointIds = ref<string[]>([])
const selectedAssessmentGrade = ref('')
const selectedAssessmentSubject = ref('')
const selectedAssessmentChapter = ref('')
const assessmentPurpose = ref('检查本周学习内容的理解和迁移能力')
const assessmentCount = ref(3)
const assessmentDeliveryMode = ref<'passport' | 'weekend_paper'>(
  'weekend_paper',
)
const assessmentSelectionMode = ref<'manual' | 'auto_core'>('manual')
const recommendationReasons = ref<Record<string, string[]>>({})
const creatingAssessment = ref(false)
const modelConfigs = ref<ModelConfigs | null>(null)
const selectedModelCapability = ref<ModelCapability>('chat')
const savingModelConfig = ref(false)
const modelMessage = ref('')
const modelError = ref('')
const mastery = ref<MasterySnapshot | null>(null)
const masteryLoading = ref(false)
const masteryError = ref('')
const masteryMessage = ref('')
const masteryReviewNotes = ref<Record<string, string>>({})
const reviewingKnowledgePointId = ref('')
const wrongBook = ref<WrongBookSnapshot | null>(null)
const wrongBookStatus = ref<WrongItemStatus | 'all'>('active')
const wrongBookLoading = ref(false)
const wrongBookError = ref('')
const wrongBookMessage = ref('')
const selectedWrongPhoto = ref<File | null>(null)
const wrongPhotoInput = ref<HTMLInputElement | null>(null)
const uploadingWrongPhoto = ref(false)
const savingWrongItemId = ref('')
const wrongItemDrafts = ref<
  Record<string, { kpId: string; tags: string; note: string }>
>({})
const wordbooks = ref<Wordbook[]>([])
const wordbooksLoading = ref(false)
const wordbookFile = ref<File | null>(null)
const wordbookInput = ref<HTMLInputElement | null>(null)
const uploadingWordbook = ref(false)
const confirmingWordbookId = ref('')
const deletingWordbookId = ref('')
const reviewingWordbook = ref<Wordbook | null>(null)
const loadingWordbookId = ref('')
const savingWordbook = ref(false)
const wordbookMessage = ref('')
const wordbookError = ref('')
const wordQuizBookId = ref('')
const wordQuizDirection = ref<WordQuizDirection>('en_to_zh')
const wordQuizCount = ref(10)
const wordQuizDeliveryMode = ref<'passport' | 'web'>('passport')
const creatingWordQuiz = ref(false)
const wordQuizzes = ref<WordQuiz[]>([])
const wordQuizzesLoading = ref(false)
const activeWordQuiz = ref<{
  quiz: WordQuiz
  questions: WordQuizQuestion[]
  progress: WordQuizProgress[]
} | null>(null)
const wordAnswerIndex = ref(0)
const wordAnswers = ref<Record<string, 'A' | 'B' | 'C' | 'D'>>({})
const wordQuizResults = ref<
  WordQuizProgress[] | null
>(null)
const openingWordQuizId = ref('')
const submittingWordQuiz = ref(false)
const wordStats = ref<WordStats | null>(null)
const wordWrongItems = ref<WordWrongItem[]>([])
const wordWrongStatus = ref<WordWrongItemStatus>('active')
const wordWrongLoading = ref(false)
const taskSnapshot = ref<TaskSnapshot | null>(null)
const curriculumProgress = ref<CurriculumProgress[]>([])
const weeklyReport = ref<WeeklyReport | null>(null)
const planningLoading = ref(false)
const planningError = ref('')
const planningMessage = ref('')
const savingPlanningItem = ref(false)
const progressMappingSelections = ref<Record<string, string>>({})
const taskDraft = ref({
  source: 'parent' as 'parent' | 'school',
  kind: 'homework' as LearningTask['kind'],
  title: '',
  description: '',
  subject: '数学',
  kpId: '',
  dueAt: '',
  estimatedMinutes: 15,
  priority: 2 as 1 | 2 | 3,
})
const progressDraft = ref({
  subject: '数学',
  chapter: '',
  kpId: '',
  effectiveDate: new Date().toISOString().slice(0, 10),
})
type ModelTarget = 'primary' | 'fallback'
interface ModelCatalog {
  models: string[]
  query: string
  loading: boolean
  loaded: boolean
}
const modelDrafts = ref<
  Record<
    ModelCapability,
    {
      enabled: boolean
      primary: { baseUrl: string; model: string; apiKey: string }
      fallbackEnabled: boolean
      fallback: { baseUrl: string; model: string; apiKey: string }
      retryCount: number
      timeoutMs: number
    }
  >
>({
  chat: emptyModelDraft(),
  embedding: emptyModelDraft(),
  vision: emptyModelDraft(),
})
const modelCatalogs = ref<
  Record<ModelCapability, Record<ModelTarget, ModelCatalog>>
>({
  chat: emptyModelCatalogs(),
  embedding: emptyModelCatalogs(),
  vision: emptyModelCatalogs(),
})

let timer: number | undefined
let textbookProgressTimer: number | undefined
let activeUploadStartedAt = 0

const currentQuestion = computed(
  () => training.value?.questions[questionIndex.value] ?? null,
)
const progress = computed(() => {
  if (!training.value?.questions.length) return 0
  return ((questionIndex.value + 1) / training.value.questions.length) * 100
})
const elapsedLabel = computed(() => {
  const minutes = Math.floor(elapsedSeconds.value / 60)
  const seconds = elapsedSeconds.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
const trainingComplete = computed(
  () =>
    Boolean(training.value?.questions.length) &&
    questionIndex.value >= (training.value?.questions.length ?? 0),
)
const noTrainingAssigned = computed(
  () => Boolean(training.value) && training.value?.questions.length === 0,
)
const confirmedWordbooks = computed(() =>
  wordbooks.value.filter((item) => item.status === 'confirmed'),
)
const currentWordQuestion = computed(
  () => activeWordQuiz.value?.questions[wordAnswerIndex.value] ?? null,
)
const currentWordSelection = computed(() => {
  const question = currentWordQuestion.value
  if (!question) return ''
  return wordAnswers.value[question.id] ?? ''
})
const wordAnsweredCount = computed(() => Object.keys(wordAnswers.value).length)
const wordCorrectCount = computed(
  () => wordQuizResults.value?.filter((item) => item.isCorrect).length ?? 0,
)
const wordAccuracyLabel = computed(() => {
  if (!wordStats.value?.totalAnswers) return '—'
  return `${Math.round(wordStats.value.accuracy * 100)}%`
})
const publishedKnowledgePointCount = computed(
  () =>
    content.value?.knowledgePoints.filter((item) => item.status === 'published')
      .length ?? 0,
)
interface AssessmentKnowledgePoint extends KnowledgePoint {
  grade: string
  subject: string
  chapterTitle: string
}
type TextbookChapter = TextbookImport['draft']['chapters'][number]
type DraftKnowledgePoint = TextbookChapter['knowledgePoints'][number]

const assessmentKnowledgePoints = computed<AssessmentKnowledgePoint[]>(() => {
  const metadata = new Map<
    string,
    { grade: string; subject: string; chapterTitle: string }
  >()
  const confirmedImports = textbookImports.value.filter(
    (item) => item.status === 'confirmed',
  )
  const imports = confirmedImports.length
    ? confirmedImports
    : textbookImports.value

  for (const textbook of imports) {
    for (const chapter of textbook.draft.chapters) {
      for (const knowledgePoint of chapter.knowledgePoints) {
        if (!metadata.has(knowledgePoint.code)) {
          metadata.set(knowledgePoint.code, {
            grade: textbook.draft.grade,
            subject: textbook.draft.subject,
            chapterTitle: chapter.title,
          })
        }
      }
    }
  }

  return (content.value?.knowledgePoints ?? [])
    .filter((item) => item.status === 'published')
    .map((item) => {
      const details = metadata.get(item.code)
      return {
        ...item,
        grade: details?.grade || '未分类',
        subject: details?.subject || '未分类',
        chapterTitle: details?.chapterTitle || item.chapter || '未分章',
      }
    })
})
const assessmentGradeOptions = computed(() =>
  sortedUnique(assessmentKnowledgePoints.value.map((item) => item.grade)),
)
const assessmentSubjectOptions = computed(() =>
  sortedUnique(
    assessmentKnowledgePoints.value
      .filter((item) => item.grade === selectedAssessmentGrade.value)
      .map((item) => item.subject),
  ),
)
const assessmentChapterOptions = computed(() =>
  sortedChapterTitles(
    assessmentKnowledgePoints.value
      .filter(
        (item) =>
          item.grade === selectedAssessmentGrade.value &&
          item.subject === selectedAssessmentSubject.value,
      )
      .map((item) => item.chapterTitle),
  ),
)
const filteredAssessmentKnowledgePoints = computed(() =>
  assessmentKnowledgePoints.value
    .filter(
      (item) =>
        item.grade === selectedAssessmentGrade.value &&
        item.subject === selectedAssessmentSubject.value &&
        item.chapterTitle === selectedAssessmentChapter.value,
    )
    .sort(compareKnowledgePointsByPage),
)
const selectedAssessmentKnowledgePoints = computed(() => {
  const byId = new Map(
    assessmentKnowledgePoints.value.map((item) => [item.id, item]),
  )
  return selectedKnowledgePointIds.value.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
})
const selectedAssessmentChapterCount = computed(
  () =>
    new Set(
      selectedAssessmentKnowledgePoints.value.map((item) => item.chapterTitle),
    ).size,
)
const activeTextbookImport = computed(
  () =>
    textbookImports.value.find((item) => item.status === 'ready_for_review') ??
    textbookImports.value[0] ??
    null,
)
const sortedTextbookChapters = computed(() =>
  (activeTextbookImport.value?.draft.chapters ?? [])
    .map((chapter) => ({
      ...chapter,
      knowledgePoints: [...chapter.knowledgePoints].sort(
        compareDraftKnowledgePointsByPage,
      ),
    }))
    .sort(compareTextbookChapters),
)
const sortedPublishedKnowledgePoints = computed(() =>
  [...(content.value?.knowledgePoints ?? [])].sort(
    compareKnowledgePointsByPage,
  ),
)
const draftKnowledgePointCount = computed(
  () =>
    activeTextbookImport.value?.draft.chapters.reduce(
      (total, chapter) => total + chapter.knowledgePoints.length,
      0,
    ) ?? 0,
)
const selectedModelConfig = computed(
  () =>
    modelConfigs.value?.capabilities.find(
      (item) => item.capability === selectedModelCapability.value,
    ) ?? null,
)
const selectedModelDraft = computed(
  () => modelDrafts.value[selectedModelCapability.value],
)
const selectedPrimaryCatalog = computed(
  () => modelCatalogs.value[selectedModelCapability.value].primary,
)
const selectedFallbackCatalog = computed(
  () => modelCatalogs.value[selectedModelCapability.value].fallback,
)
onMounted(async () => {
  try {
    session.value = await getSession()
    await enterWorkspace()
  } catch {
    const restored = await restoreCachedChildWorkspace()
    if (restored) await enterWorkspace(true)
    else session.value = null
  } finally {
    authReady.value = true
  }
  window.addEventListener('online', runSync)
  syncCount.value = await pendingCount()
})

onBeforeUnmount(() => {
  window.removeEventListener('online', runSync)
  if (timer) window.clearInterval(timer)
  stopTextbookProgressPolling()
  void persistChildWorkspace()
})

async function handleLogin() {
  loading.value = true
  authError.value = ''
  try {
    session.value = await login(role.value, credential.value)
    await enterWorkspace()
  } catch (error) {
    authError.value = error instanceof Error ? error.message : '登录失败'
  } finally {
    loading.value = false
  }
}

async function enterWorkspace(useCachedWorkspace = false) {
  if (session.value?.role === 'child') {
    if (!useCachedWorkspace) {
      training.value = await getTodayTraining()
      questionIndex.value = 0
      attemptIds.value = {}
      elapsedSeconds.value = training.value.budget.elapsedSeconds
      await persistChildWorkspace()
    }
    if (!training.value) throw new Error('没有可恢复的训练计划')

    startedAt.value = Date.now() - elapsedSeconds.value * 1000
    if (training.value.activeAttempt && !useCachedWorkspace) {
      attemptIds.value[training.value.activeAttempt.questionId] =
        training.value.activeAttempt.attemptId
      const activeIndex = training.value.questions.findIndex(
        (question) =>
          question.id === training.value?.activeAttempt?.questionId,
      )
      if (activeIndex >= 0) questionIndex.value = activeIndex
    }
    const pendingAnswer = currentQuestion.value
      ? await findPendingAnswer(currentQuestion.value.id)
      : undefined
    if (pendingAnswer) {
      attemptIds.value[pendingAnswer.questionId] = pendingAnswer.attemptId
      selectedAnswer.value = pendingAnswer.answer
      pendingAnswerQuestionId.value = pendingAnswer.questionId
      actionError.value = '这份答案已离线保存，联网后会自动判题。'
    }
    timer = window.setInterval(() => {
      elapsedSeconds.value = Math.floor((Date.now() - startedAt.value) / 1000)
    }, 1000)
    if (training.value.questions.length && !training.value.budget.sessionClosed) {
      await enqueueEvent({
        type: 'training_started',
        businessKey: training.value.planId,
        payload: { planId: training.value.planId },
      })
      await runSync()
      if (
        !training.value.activeAttempt &&
        !training.value.budget.stopAddingQuestions &&
        !pendingAnswer
      ) {
        await beginCurrentQuestion()
      }
    }
  } else if (session.value?.role === 'parent') {
    await loadContent()
  }
}

async function handleLogout() {
  try {
    await logout()
  } catch {
    // An offline child can still end the local session.
  } finally {
    await clearCachedChildWorkspace()
    session.value = null
    training.value = null
    content.value = null
    wrongBook.value = null
    childMode.value = 'training'
    questionIndex.value = 0
    attemptIds.value = {}
    pendingAnswerQuestionId.value = ''
    credential.value = ''
    if (timer) window.clearInterval(timer)
  }
}

async function restoreCachedChildWorkspace(): Promise<boolean> {
  const cached = await getCachedChildWorkspace()
  if (!cached) return false
  session.value = cached.session
  training.value = cached.training
  questionIndex.value = Math.min(
    cached.questionIndex,
    cached.training.questions.length,
  )
  attemptIds.value = cached.attemptIds
  elapsedSeconds.value = cached.elapsedSeconds
  return true
}

async function persistChildWorkspace(): Promise<void> {
  if (session.value?.role !== 'child' || !training.value) return
  await cacheChildWorkspace({
    session: session.value,
    training: training.value,
    questionIndex: questionIndex.value,
    attemptIds: attemptIds.value,
    elapsedSeconds: elapsedSeconds.value,
  })
}

function shouldQueueOffline(error: unknown): boolean {
  return (
    !navigator.onLine ||
    !(error instanceof ApiError) ||
    error.retryable
  )
}

async function loadContent() {
  contentLoading.value = true
  contentError.value = ''
  try {
    const [
      nextContent,
      imports,
      assessmentResult,
      nextModelConfigs,
      currentTextbookProgress,
    ] =
      await Promise.all([
        getContent(),
        getTextbookImports(),
        getAssessments(),
        getModelConfigs(),
        getTextbookProgress(),
      ])
    content.value = nextContent
    textbookImports.value = imports.imports
    textbookChatConfigured.value = imports.configured
    assessments.value = assessmentResult.assessments
    modelConfigs.value = nextModelConfigs
    initializeModelDrafts(nextModelConfigs)
    initializeAssessmentFilters()
    if (
      currentTextbookProgress &&
      isActiveTextbookProgress(currentTextbookProgress)
    ) {
      textbookProgress.value = currentTextbookProgress
      importingTextbook.value = true
      startTextbookProgressPolling()
    }
  } catch (error) {
    contentError.value =
      error instanceof Error ? error.message : '暂时无法加载内容'
  } finally {
    contentLoading.value = false
  }
}

async function openParentMode(
  nextMode:
    | 'assessment'
    | 'planning'
    | 'content'
    | 'wrongBook'
    | 'review'
    | 'models'
    | 'words',
) {
  parentMode.value = nextMode
  if (nextMode === 'review') await loadMastery()
  if (nextMode === 'wrongBook') await loadWrongBook()
  if (nextMode === 'planning') await loadPlanning()
  if (nextMode === 'words') {
    await loadWordbooks()
    await loadWordStats()
  }
}

async function openChildMode(
  nextMode: 'training' | 'tasks' | 'wrongBook' | 'words',
) {
  childMode.value = nextMode
  if (nextMode === 'wrongBook') {
    wrongBookStatus.value = 'active'
    await loadWrongBook()
  }
  if (nextMode === 'tasks') await loadChildTasks()
  if (nextMode === 'words') {
    activeWordQuiz.value = null
    wordQuizResults.value = null
    await Promise.all([loadWordQuizzes(), loadWordStats(), loadWordWrongItems()])
  }
}

async function loadWordbooks() {
  wordbooksLoading.value = true
  wordbookError.value = ''
  try {
    wordbooks.value = await listWordbooks()
    if (!wordQuizBookId.value) {
      const first = wordbooks.value.find((item) => item.status === 'confirmed')
      if (first) wordQuizBookId.value = first.id
    }
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '单词本加载失败'
  } finally {
    wordbooksLoading.value = false
  }
}

function handleWordbookFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  wordbookFile.value = input.files?.[0] ?? null
}

async function handleWordbookUpload() {
  const file = wordbookFile.value
  if (!file) return
  uploadingWordbook.value = true
  wordbookError.value = ''
  wordbookMessage.value = ''
  try {
    const wordbook = await uploadWordbook(file)
    wordbookMessage.value = `已识别 ${wordbook.entryCount} 个词条，请确认后使用`
    wordbookFile.value = null
    if (wordbookInput.value) wordbookInput.value.value = ''
    await loadWordbooks()
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '单词本上传失败'
  } finally {
    uploadingWordbook.value = false
  }
}

async function handleConfirmWordbook(wordbook: Wordbook) {
  confirmingWordbookId.value = wordbook.id
  wordbookError.value = ''
  try {
    if (reviewingWordbook.value?.id === wordbook.id) {
      await updateWordbook(wordbook.id, reviewingWordbook.value.entries ?? [])
    }
    await confirmWordbook(wordbook.id)
    reviewingWordbook.value = null
    wordbookMessage.value = '单词本已确认，可以下发考察'
    await loadWordbooks()
    wordQuizBookId.value = wordbook.id
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '确认单词本失败'
  } finally {
    confirmingWordbookId.value = ''
  }
}

async function openWordbookReview(wordbook: Wordbook) {
  loadingWordbookId.value = wordbook.id
  wordbookError.value = ''
  try {
    reviewingWordbook.value = await getWordbook(wordbook.id)
  } catch (error) {
    wordbookError.value = error instanceof Error ? error.message : '词条加载失败'
  } finally {
    loadingWordbookId.value = ''
  }
}

async function saveWordbookReview() {
  const book = reviewingWordbook.value
  if (!book || savingWordbook.value) return
  savingWordbook.value = true
  wordbookError.value = ''
  try {
    reviewingWordbook.value = await updateWordbook(book.id, book.entries ?? [])
    wordbookMessage.value = '词条校对已保存'
    await loadWordbooks()
  } catch (error) {
    wordbookError.value = error instanceof Error ? error.message : '词条保存失败'
  } finally {
    savingWordbook.value = false
  }
}

async function handleDeleteWordbook(wordbook: Wordbook) {
  deletingWordbookId.value = wordbook.id
  wordbookError.value = ''
  try {
    await deleteWordbook(wordbook.id)
    if (reviewingWordbook.value?.id === wordbook.id) reviewingWordbook.value = null
    if (wordQuizBookId.value === wordbook.id) wordQuizBookId.value = ''
    wordbookMessage.value = '单词本已删除'
    await loadWordbooks()
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '删除单词本失败'
  } finally {
    deletingWordbookId.value = ''
  }
}

async function handleCreateWordQuiz() {
  if (!wordQuizBookId.value) return
  creatingWordQuiz.value = true
  wordbookError.value = ''
  wordbookMessage.value = ''
  try {
    const result = await createWordQuiz({
      wordbookId: wordQuizBookId.value,
      direction: wordQuizDirection.value,
      count: wordQuizCount.value,
      deliveryMode: wordQuizDeliveryMode.value,
    })
    wordbookMessage.value =
      wordQuizDeliveryMode.value === 'passport'
        ? `已安排 ${result.questionCount} 道单词题，随身设备联网刷新后获取`
        : `已生成 ${result.questionCount} 道单词题，可在网页端作答`
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '创建单词考察失败'
  } finally {
    creatingWordQuiz.value = false
  }
}

async function loadWordQuizzes() {
  wordQuizzesLoading.value = true
  try {
    wordQuizzes.value = await listWordQuizzes(20)
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '单词考察加载失败'
  } finally {
    wordQuizzesLoading.value = false
  }
}

async function openWordQuiz(quiz: WordQuiz) {
  if (openingWordQuizId.value) return
  openingWordQuizId.value = quiz.id
  wordbookError.value = ''
  wordQuizResults.value = null
  try {
    const detail = await getWordQuiz(quiz.id)
    activeWordQuiz.value = detail
    let draft: Record<string, unknown> = {}
    try { draft = JSON.parse(localStorage.getItem(`word-quiz:${quiz.id}`) ?? '{}') ?? {} } catch { /* 忽略损坏的草稿 */ }
    const restored: Record<string, 'A' | 'B' | 'C' | 'D'> = {}
    for (const question of detail.questions) {
      const key = draft[question.id]
      if (key === 'A' || key === 'B' || key === 'C' || key === 'D') restored[question.id] = key
    }
    for (const answer of detail.progress) restored[answer.questionId] = answer.selectedKey
    wordAnswers.value = restored
    const index = detail.questions.findIndex((question) => !restored[question.id])
    wordAnswerIndex.value = Math.max(index, 0)
    if (detail.quiz.status === 'completed' ||
      (detail.questions.length > 0 && detail.progress.length === detail.questions.length)) {
      wordQuizResults.value = detail.progress
    }
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '题目加载失败'
  } finally {
    openingWordQuizId.value = ''
  }
}

function selectWordOption(key: 'A' | 'B' | 'C' | 'D') {
  const question = activeWordQuiz.value?.questions[wordAnswerIndex.value]
  if (!question) return
  if (submittingWordQuiz.value || activeWordQuiz.value?.progress.some((item) => item.questionId === question.id)) return
  wordAnswers.value = { ...wordAnswers.value, [question.id]: key }
  try {
    localStorage.setItem(`word-quiz:${activeWordQuiz.value!.quiz.id}`, JSON.stringify(wordAnswers.value))
  } catch {
    wordbookError.value = '浏览器无法保存草稿，请完成本轮后提交'
  }
}

function stepWordQuiz(delta: number) {
  const total = activeWordQuiz.value?.questions.length ?? 0
  const next = wordAnswerIndex.value + delta
  if (next < 0 || next >= total) return
  wordAnswerIndex.value = next
}

async function handleSubmitWordQuiz() {
  const quiz = activeWordQuiz.value
  if (!quiz || submittingWordQuiz.value) return
  if (quiz.questions.some((question) => !wordAnswers.value[question.id])) {
    wordbookError.value = '请先完成所有题目，再提交本轮'
    return
  }
  const persistedIds = new Set(quiz.progress.map((item) => item.questionId))
  const answers = Object.entries(wordAnswers.value).filter(([id]) => !persistedIds.has(id)).map(
    ([questionId, selectedKey]) => ({ questionId, selectedKey }),
  )
  if (!answers.length) return
  submittingWordQuiz.value = true
  wordbookError.value = ''
  try {
    const result = await submitWordAnswers(quiz.quiz.id, answers)
    quiz.progress = result.results
    if (result.completed) {
      wordQuizResults.value = result.results
      try { localStorage.removeItem(`word-quiz:${quiz.quiz.id}`) } catch { /* 已保存到服务端 */ }
    } else {
      wordbookError.value = `已保存 ${result.answeredCount} 题，请继续完成本轮`
    }
    await Promise.all([loadWordStats(), loadWordWrongItems()])
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '提交答案失败'
  } finally {
    submittingWordQuiz.value = false
  }
}

async function loadWordStats() {
  try {
    wordStats.value = await getWordStats()
  } catch {
    wordStats.value = null
  }
}

async function loadWordWrongItems() {
  wordWrongLoading.value = true
  try {
    wordWrongItems.value = await getWordWrongItems(wordWrongStatus.value)
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '单词错题加载失败'
  } finally {
    wordWrongLoading.value = false
  }
}

async function switchWordWrongStatus(status: WordWrongItemStatus) {
  wordWrongStatus.value = status
  await loadWordWrongItems()
}

function handleWordWrongStatusChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  void switchWordWrongStatus(value as WordWrongItemStatus)
}

async function handleWordWrongStatus(
  item: WordWrongItem,
  status: WordWrongItemStatus,
) {
  try {
    await updateWordWrongItem(item.id, status)
    await loadWordWrongItems()
  } catch (error) {
    wordbookError.value =
      error instanceof Error ? error.message : '更新单词错题失败'
  }
}

async function loadChildTasks() {
  planningLoading.value = true
  planningError.value = ''
  try {
    taskSnapshot.value = await getTasks()
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '任务加载失败'
  } finally {
    planningLoading.value = false
  }
}

async function loadPlanning() {
  if (planningLoading.value) return
  planningLoading.value = true
  planningError.value = ''
  try {
    const [tasks, progressItems, report] = await Promise.all([
      getTasks(),
      getCurriculumProgress(),
      getWeeklyReport(),
    ])
    taskSnapshot.value = tasks
    curriculumProgress.value = progressItems
    weeklyReport.value = report
    progressMappingSelections.value = Object.fromEntries(
      progressItems.map((item) => [item.id, item.kpId ?? '']),
    )
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '学习计划加载失败'
  } finally {
    planningLoading.value = false
  }
}

async function submitTaskDraft() {
  if (!taskDraft.value.title.trim() || savingPlanningItem.value) return
  savingPlanningItem.value = true
  planningError.value = ''
  planningMessage.value = ''
  try {
    await createTask({
      source: taskDraft.value.source,
      kind: taskDraft.value.kind,
      title: taskDraft.value.title.trim(),
      description: taskDraft.value.description.trim(),
      subject: taskDraft.value.subject.trim(),
      ...(taskDraft.value.kpId ? { kpId: taskDraft.value.kpId } : {}),
      ...(taskDraft.value.dueAt
        ? { dueAt: new Date(taskDraft.value.dueAt).toISOString() }
        : {}),
      estimatedMinutes: taskDraft.value.estimatedMinutes,
      priority: taskDraft.value.priority,
    })
    taskDraft.value.title = ''
    taskDraft.value.description = ''
    planningMessage.value = '任务已加入孩子的任务中心'
    await loadPlanning()
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '任务创建失败'
  } finally {
    savingPlanningItem.value = false
  }
}

async function submitProgressDraft() {
  if (!progressDraft.value.chapter.trim() || savingPlanningItem.value) return
  savingPlanningItem.value = true
  planningError.value = ''
  planningMessage.value = ''
  try {
    await createCurriculumProgress({
      subject: progressDraft.value.subject,
      chapter: progressDraft.value.chapter.trim(),
      ...(progressDraft.value.kpId ? { kpId: progressDraft.value.kpId } : {}),
      source: 'parent',
      confidence: progressDraft.value.kpId ? 1 : 0,
      effectiveDate: progressDraft.value.effectiveDate,
    })
    progressDraft.value.chapter = ''
    planningMessage.value = '教学进度已保存'
    await loadPlanning()
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '教学进度保存失败'
  } finally {
    savingPlanningItem.value = false
  }
}

async function confirmProgressMapping(item: CurriculumProgress) {
  const kpId = progressMappingSelections.value[item.id]
  if (!kpId || savingPlanningItem.value) return
  savingPlanningItem.value = true
  planningError.value = ''
  try {
    await confirmCurriculumProgress(item.id, kpId)
    planningMessage.value = '映射已确认，并自动创建预习任务'
    await loadPlanning()
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '进度确认失败'
  } finally {
    savingPlanningItem.value = false
  }
}

async function updateTaskState(
  task: LearningTask,
  status: 'pending' | 'claimed_done' | 'verified' | 'cancelled',
) {
  if (savingPlanningItem.value) return
  savingPlanningItem.value = true
  planningError.value = ''
  try {
    await changeTaskStatus(task.id, status)
    planningMessage.value =
      status === 'claimed_done' ? '已提交完成确认' : '任务状态已更新'
    if (session.value?.role === 'parent') await loadPlanning()
    else await loadChildTasks()
  } catch (error) {
    planningError.value =
      error instanceof Error ? error.message : '任务状态更新失败'
  } finally {
    savingPlanningItem.value = false
  }
}

async function loadWrongBook() {
  if (wrongBookLoading.value) return
  wrongBookLoading.value = true
  wrongBookError.value = ''
  try {
    const status =
      wrongBookStatus.value === 'all' ? undefined : wrongBookStatus.value
    wrongBook.value = await getWrongItems(status)
    wrongItemDrafts.value = Object.fromEntries(
      wrongBook.value.items.map((item) => [
        item.id,
        {
          kpId: item.kpId ?? '',
          tags: item.tags.join('、'),
          note: item.note,
        },
      ]),
    )
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '错题集加载失败'
  } finally {
    wrongBookLoading.value = false
  }
}

function chooseWrongPhoto(event: Event) {
  selectedWrongPhoto.value =
    (event.target as HTMLInputElement).files?.[0] ?? null
}

async function uploadWrongPhoto() {
  if (!selectedWrongPhoto.value || uploadingWrongPhoto.value) return
  uploadingWrongPhoto.value = true
  wrongBookError.value = ''
  wrongBookMessage.value = ''
  try {
    await uploadWrongItemPhoto(selectedWrongPhoto.value)
    selectedWrongPhoto.value = null
    if (wrongPhotoInput.value) wrongPhotoInput.value.value = ''
    wrongBookStatus.value = 'active'
    wrongBookMessage.value = '照片错题已识别并加入错题集'
    await loadWrongBook()
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '照片错题识别失败'
  } finally {
    uploadingWrongPhoto.value = false
  }
}

async function saveWrongItem(item: WrongItem) {
  const draft = wrongItemDrafts.value[item.id]
  if (!draft || savingWrongItemId.value) return
  savingWrongItemId.value = item.id
  wrongBookError.value = ''
  wrongBookMessage.value = ''
  try {
    await updateWrongItem(item.id, {
      ...(draft.kpId ? { kpId: draft.kpId } : {}),
      tags: draft.tags
        .split(/[、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      note: draft.note,
    })
    wrongBookMessage.value = '错题信息已保存'
    await loadWrongBook()
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '错题保存失败'
  } finally {
    savingWrongItemId.value = ''
  }
}

async function setWrongItemStatus(
  item: WrongItem,
  status: WrongItemStatus,
) {
  if (savingWrongItemId.value) return
  savingWrongItemId.value = item.id
  wrongBookError.value = ''
  try {
    await updateWrongItem(item.id, { status })
    await loadWrongBook()
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '错题状态更新失败'
  } finally {
    savingWrongItemId.value = ''
  }
}

async function removeWrongItem(item: WrongItem) {
  if (savingWrongItemId.value) return
  savingWrongItemId.value = item.id
  wrongBookError.value = ''
  try {
    await deleteWrongItem(item.id)
    wrongBookMessage.value = '错题已删除'
    await loadWrongBook()
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '错题删除失败'
  } finally {
    savingWrongItemId.value = ''
  }
}

async function submitWrongItemReview(
  item: WrongItem,
  result: 'correct' | 'incorrect',
) {
  if (savingWrongItemId.value) return
  savingWrongItemId.value = item.id
  wrongBookError.value = ''
  try {
    await reviewWrongItem(item.id, result)
    wrongBookMessage.value =
      result === 'correct' ? '已记录本次复习正确' : '已安排稍后再复习'
    await loadWrongBook()
  } catch (error) {
    wrongBookError.value =
      error instanceof Error ? error.message : '复习结果保存失败'
  } finally {
    savingWrongItemId.value = ''
  }
}

function wrongItemStatusLabel(status: WrongItemStatus): string {
  return {
    active: '待复习',
    mastered: '已掌握',
    archived: '已归档',
  }[status]
}

async function loadMastery() {
  if (masteryLoading.value) return
  masteryLoading.value = true
  masteryError.value = ''
  try {
    mastery.value = await getMastery()
  } catch (error) {
    masteryError.value =
      error instanceof Error ? error.message : '学习证据加载失败'
  } finally {
    masteryLoading.value = false
  }
}

async function reviewMastery(
  projection: MasteryProjection,
  decision: 'agree' | 'disagree' | 'unsure',
) {
  if (reviewingKnowledgePointId.value) return
  reviewingKnowledgePointId.value = projection.kpId
  masteryError.value = ''
  masteryMessage.value = ''
  try {
    await submitMasteryReview(projection.kpId, {
      projectionVersion: projection.projectionVersion,
      decision,
      ...(masteryReviewNotes.value[projection.kpId]?.trim()
        ? { note: masteryReviewNotes.value[projection.kpId].trim() }
        : {}),
    })
    masteryReviewNotes.value[projection.kpId] = ''
    masteryMessage.value = `已记录对“${projection.knowledgePointName}”的复核`
    await loadMastery()
  } catch (error) {
    masteryError.value =
      error instanceof Error ? error.message : '复核提交失败'
  } finally {
    reviewingKnowledgePointId.value = ''
  }
}

function masteryStatusLabel(status: MasteryProjection['status']): string {
  return {
    insufficient: '证据不足',
    weak: '尚未掌握',
    basic: '基本掌握',
    mastered: '已掌握',
  }[status]
}

function reviewDecisionLabel(
  decision: 'agree' | 'disagree' | 'unsure',
): string {
  return {
    agree: '同意判断',
    disagree: '不同意',
    unsure: '暂不确定',
  }[decision]
}

function masteryEvidenceHint(projection: MasteryProjection): string {
  const reasons = projection.calculationDetails.insufficiencyReasons
  if (!reasons.length) {
    return `M0 ${Math.round((projection.score ?? 0) * 100)} 分 · ${projection.spacedDayCount} 天证据`
  }
  const missing = [
    ...(reasons.includes('sample_count')
      ? [`还需 ${Math.max(0, 3 - projection.sampleCount)} 次有效作答`]
      : []),
    ...(reasons.includes('independent_count')
      ? [`还需 ${Math.max(0, 2 - projection.independentCount)} 次独立作答`]
      : []),
    ...(reasons.includes('spaced_day_count') ? ['需要跨日证据'] : []),
  ]
  return missing.join(' · ')
}

function emptyModelDraft() {
  return {
    enabled: false,
    primary: { baseUrl: '', model: '', apiKey: '' },
    fallbackEnabled: false,
    fallback: { baseUrl: '', model: '', apiKey: '' },
    retryCount: 2,
    timeoutMs: 90_000,
  }
}

function emptyModelCatalogs(): Record<ModelTarget, ModelCatalog> {
  return {
    primary: { models: [], query: '', loading: false, loaded: false },
    fallback: { models: [], query: '', loading: false, loaded: false },
  }
}

function initializeModelDrafts(configs: ModelConfigs) {
  for (const config of configs.capabilities) {
    modelDrafts.value[config.capability] = {
      enabled: config.enabled,
      primary: {
        baseUrl: config.primary.baseUrl,
        model: config.primary.model,
        apiKey: '',
      },
      fallbackEnabled: Boolean(config.fallback),
      fallback: {
        baseUrl: config.fallback?.baseUrl ?? '',
        model: config.fallback?.model ?? '',
        apiKey: '',
      },
      retryCount: config.retryCount,
      timeoutMs: config.timeoutMs,
    }
    modelCatalogs.value[config.capability] = {
      primary: {
        models: config.primary.model ? [config.primary.model] : [],
        query: config.primary.model,
        loading: false,
        loaded: Boolean(config.primary.model),
      },
      fallback: {
        models: config.fallback?.model ? [config.fallback.model] : [],
        query: config.fallback?.model ?? '',
        loading: false,
        loaded: Boolean(config.fallback?.model),
      },
    }
  }
}

function catalogFor(target: ModelTarget): ModelCatalog {
  return modelCatalogs.value[selectedModelCapability.value][target]
}

function filteredModelOptions(target: ModelTarget): string[] {
  const catalog = catalogFor(target)
  const query = catalog.query.trim().toLocaleLowerCase()
  return catalog.models
    .filter((model) => !query || model.toLocaleLowerCase().includes(query))
    .slice(0, 50)
}

function invalidateModelOptions(target: ModelTarget) {
  const endpoint = selectedModelDraft.value[target]
  endpoint.model = ''
  modelCatalogs.value[selectedModelCapability.value][target] = {
    models: [],
    query: '',
    loading: false,
    loaded: false,
  }
}

async function loadModelOptions(target: ModelTarget) {
  const capability = selectedModelCapability.value
  const endpoint = modelDrafts.value[capability][target]
  const catalog = modelCatalogs.value[capability][target]
  catalog.loading = true
  modelError.value = ''
  modelMessage.value = ''
  try {
    const models = await fetchModelOptions(capability, {
      target,
      baseUrl: endpoint.baseUrl,
      ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {}),
    })
    catalog.models = models
    catalog.loaded = true
    if (models.includes(endpoint.model)) {
      catalog.query = endpoint.model
    } else {
      endpoint.model = ''
      catalog.query = ''
    }
    if (!models.length) {
      modelError.value = '接口未返回可用模型，请检查 API 地址和账号权限'
    }
  } catch (error) {
    catalog.loaded = false
    modelError.value =
      error instanceof Error ? error.message : '模型列表获取失败'
  } finally {
    catalog.loading = false
  }
}

function selectModelOption(target: ModelTarget, model: string) {
  selectedModelDraft.value[target].model = model
  catalogFor(target).query = model
}

async function persistModelConfig() {
  const capability = selectedModelCapability.value
  const draft = modelDrafts.value[capability]
  savingModelConfig.value = true
  modelError.value = ''
  modelMessage.value = ''
  try {
    if (!catalogFor('primary').models.includes(draft.primary.model)) {
      throw new Error('请先获取并选择主模型')
    }
    if (
      draft.fallbackEnabled &&
      !catalogFor('fallback').models.includes(draft.fallback.model)
    ) {
      throw new Error('请先获取并选择回退模型')
    }
    const saved = await saveModelConfig(capability, {
      enabled: draft.enabled,
      primary: {
        baseUrl: draft.primary.baseUrl,
        model: draft.primary.model,
        ...(draft.primary.apiKey ? { apiKey: draft.primary.apiKey } : {}),
      },
      ...(draft.fallbackEnabled
        ? {
            fallback: {
              baseUrl: draft.fallback.baseUrl,
              model: draft.fallback.model,
              ...(draft.fallback.apiKey
                ? { apiKey: draft.fallback.apiKey }
                : {}),
            },
          }
        : {}),
      retryCount: draft.retryCount,
      timeoutMs: draft.timeoutMs,
    })
    if (modelConfigs.value) {
      modelConfigs.value.capabilities = modelConfigs.value.capabilities.map(
        (item) => (item.capability === capability ? saved : item),
      )
    }
    initializeModelDrafts(modelConfigs.value!)
    if (capability === 'chat') {
      textbookChatConfigured.value = saved.configured
      if (content.value) content.value.assessmentConfigured = saved.configured
    }
    modelMessage.value = '模型配置已保存并立即生效'
  } catch (error) {
    modelError.value = error instanceof Error ? error.message : '模型配置保存失败'
  } finally {
    savingModelConfig.value = false
  }
}

function chooseTextbook(event: Event) {
  selectedTextbook.value =
    (event.target as HTMLInputElement).files?.[0] ?? null
}

function isActiveTextbookProgress(progress: TextbookAnalysisProgress): boolean {
  return (
    progress.status === 'extracting' ||
    progress.status === 'analyzing' ||
    progress.status === 'saving'
  )
}

function stopTextbookProgressPolling() {
  if (textbookProgressTimer) {
    window.clearInterval(textbookProgressTimer)
    textbookProgressTimer = undefined
  }
}

function startTextbookProgressPolling() {
  stopTextbookProgressPolling()
  textbookProgressTimer = window.setInterval(() => {
    void refreshTextbookProgress()
  }, 1_000)
}

async function refreshTextbookProgress() {
  try {
    const nextProgress = await getTextbookProgress()
    if (!nextProgress) return
    if (
      activeUploadStartedAt &&
      Date.parse(nextProgress.startedAt) < activeUploadStartedAt - 1_000
    ) {
      return
    }
    textbookProgress.value = nextProgress
    if (isActiveTextbookProgress(nextProgress)) return

    stopTextbookProgressPolling()
    importingTextbook.value = false
    activeUploadStartedAt = 0
    if (nextProgress.status === 'completed') {
      const imports = await getTextbookImports()
      textbookImports.value = imports.imports
      textbookChatConfigured.value = imports.configured
    } else if (!contentError.value) {
      contentError.value = '教材分析失败，请重新提交或检查模型配置'
    }
  } catch {
    // The upload request remains authoritative; polling retries on the next tick.
  }
}

async function importTextbook() {
  if (!selectedTextbook.value || importingTextbook.value) return
  const file = selectedTextbook.value
  const startedAt = new Date().toISOString()
  activeUploadStartedAt = Date.parse(startedAt)
  importingTextbook.value = true
  textbookProgress.value = {
    jobId: 'pending',
    fileName: file.name,
    status: 'extracting',
    percent: 2,
    message: '正在上传并读取 PDF',
    completedChunks: 0,
    totalChunks: 0,
    startedAt,
    updatedAt: startedAt,
  }
  contentError.value = ''
  contentMessage.value = ''
  startTextbookProgressPolling()
  try {
    const imported = await uploadTextbook(file)
    textbookImports.value = [
      imported,
      ...textbookImports.value.filter((item) => item.id !== imported.id),
    ]
    await refreshTextbookProgress()
    contentMessage.value = '教材分析完成，请检查知识结构后确认'
    selectedTextbook.value = null
    if (textbookInput.value) textbookInput.value.value = ''
  } catch (error) {
    await refreshTextbookProgress()
    contentError.value =
      error instanceof Error ? error.message : '教材分析失败'
  } finally {
    importingTextbook.value = false
    activeUploadStartedAt = 0
    stopTextbookProgressPolling()
  }
}

async function confirmActiveTextbook() {
  const item = activeTextbookImport.value
  if (!item || contentLoading.value) return
  contentLoading.value = true
  contentError.value = ''
  contentMessage.value = ''
  try {
    await confirmTextbookImport(item.id)
    contentMessage.value = '教材知识结构已确认，可按需发起考察'
    await loadContent()
  } catch (error) {
    contentError.value =
      error instanceof Error ? error.message : '确认发布失败'
  } finally {
    contentLoading.value = false
  }
}

function toggleKnowledgePoint(id: string) {
  if (selectedKnowledgePointIds.value.includes(id)) {
    removeKnowledgePoint(id)
    return
  }
  if (selectedKnowledgePointIds.value.length >= 20) {
    contentError.value = '一次考察最多选择 20 个知识点，请先删除不需要的知识点'
    return
  }
  selectedKnowledgePointIds.value = [...selectedKnowledgePointIds.value, id]
  assessmentSelectionMode.value = 'manual'
  contentError.value = ''
}

function removeKnowledgePoint(id: string) {
  selectedKnowledgePointIds.value = selectedKnowledgePointIds.value.filter(
    (item) => item !== id,
  )
  delete recommendationReasons.value[id]
  assessmentSelectionMode.value = 'manual'
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, 'zh-CN'),
  )
}

function compareTextbookChapters(
  left: TextbookChapter,
  right: TextbookChapter,
): number {
  const leftNumber = chapterNumber(left.title)
  const rightNumber = chapterNumber(right.title)
  if (leftNumber !== undefined && rightNumber !== undefined) {
    const chapterDifference = leftNumber - rightNumber
    if (chapterDifference) return chapterDifference
  } else if (leftNumber !== undefined) {
    return -1
  } else if (rightNumber !== undefined) {
    return 1
  }
  return (
    left.pageStart - right.pageStart ||
    left.pageEnd - right.pageEnd ||
    left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
    left.title.localeCompare(right.title, 'zh-CN')
  )
}

function compareDraftKnowledgePointsByPage(
  left: DraftKnowledgePoint,
  right: DraftKnowledgePoint,
): number {
  return (
    left.pageStart - right.pageStart ||
    left.pageEnd - right.pageEnd ||
    left.code.localeCompare(right.code, 'zh-CN', { numeric: true }) ||
    left.name.localeCompare(right.name, 'zh-CN')
  )
}

function compareKnowledgePointsByPage(
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

function formatPageRange(start?: number, end?: number): string {
  if (start === undefined && end === undefined) return '页码待补充'
  const firstPage = start ?? end!
  const lastPage = end ?? start!
  return firstPage === lastPage
    ? `第 ${firstPage} 页`
    : `第 ${firstPage}–${lastPage} 页`
}

function sortedChapterTitles(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => {
    const leftNumber = chapterNumber(left)
    const rightNumber = chapterNumber(right)
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber - rightNumber
    }
    if (leftNumber !== undefined) return -1
    if (rightNumber !== undefined) return 1
    return left.localeCompare(right, 'zh-CN')
  })
}

function chapterNumber(title: string): number | undefined {
  const value = title.match(
    /^第\s*(\d+|[〇零一二三四五六七八九十]+)\s*章/u,
  )?.[1]
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value)

  const digits: Record<string, number> = {
    〇: 0,
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (value === '十') return 10
  const [tens, ones] = value.split('十')
  if (value.includes('十')) {
    const tensValue = tens ? digits[tens] : 1
    const onesValue = ones ? digits[ones] : 0
    return tensValue === undefined || onesValue === undefined
      ? undefined
      : tensValue * 10 + onesValue
  }
  return digits[value]
}

function initializeAssessmentFilters() {
  selectedAssessmentGrade.value = assessmentGradeOptions.value.includes(
    selectedAssessmentGrade.value,
  )
    ? selectedAssessmentGrade.value
    : assessmentGradeOptions.value[0] ?? ''
  selectedAssessmentSubject.value = assessmentSubjectOptions.value.includes(
    selectedAssessmentSubject.value,
  )
    ? selectedAssessmentSubject.value
    : assessmentSubjectOptions.value[0] ?? ''
  selectedAssessmentChapter.value = assessmentChapterOptions.value.includes(
    selectedAssessmentChapter.value,
  )
    ? selectedAssessmentChapter.value
    : assessmentChapterOptions.value[0] ?? ''
}

function changeAssessmentGrade() {
  selectedAssessmentSubject.value = assessmentSubjectOptions.value[0] ?? ''
  selectedAssessmentChapter.value = assessmentChapterOptions.value[0] ?? ''
}

function changeAssessmentSubject() {
  selectedAssessmentChapter.value = assessmentChapterOptions.value[0] ?? ''
}

function changeAssessmentChapter() {}

async function autoSelectKnowledgePoints() {
  if (creatingAssessment.value) return
  creatingAssessment.value = true
  contentError.value = ''
  contentMessage.value = ''
  try {
    const recommendations = await getAssessmentRecommendations(
      Math.min(8, Math.max(4, assessmentCount.value)),
    )
    selectedKnowledgePointIds.value = recommendations.map((item) => item.id)
    recommendationReasons.value = Object.fromEntries(
      recommendations.map((item) => [item.id, item.reasons]),
    )
    assessmentSelectionMode.value = 'auto_core'
    contentMessage.value = `已跨章节圈选 ${recommendations.length} 个核心高热知识点`
  } catch (error) {
    contentError.value =
      error instanceof Error ? error.message : '自动圈选失败'
  } finally {
    creatingAssessment.value = false
  }
}

async function assignAssessment() {
  if (!selectedKnowledgePointIds.value.length || creatingAssessment.value) return
  creatingAssessment.value = true
  contentError.value = ''
  contentMessage.value = ''
  try {
    const assessment = await createAssessment({
      knowledgePointIds: selectedKnowledgePointIds.value,
      purpose: assessmentPurpose.value,
      count: assessmentCount.value,
      deliveryMode: assessmentDeliveryMode.value,
      selectionMode: assessmentSelectionMode.value,
    })
    assessments.value = [assessment, ...assessments.value]
    selectedKnowledgePointIds.value = []
    contentMessage.value = `已生成并下发 ${assessment.questionIds.length} 道考察题`
  } catch (error) {
    contentError.value = error instanceof Error ? error.message : '考察发起失败'
  } finally {
    creatingAssessment.value = false
  }
}

async function assignRoutineAssessment() {
  if (creatingAssessment.value) return
  creatingAssessment.value = true
  contentError.value = ''
  contentMessage.value = ''
  try {
    const assessment = await createRoutineAssessment(3)
    assessments.value = [assessment, ...assessments.value]
    contentMessage.value = `例行考察已生成并下发 ${assessment.questionIds.length} 道题`
  } catch (error) {
    contentError.value = error instanceof Error ? error.message : '例行考察生成失败'
  } finally {
    creatingAssessment.value = false
  }
}

function setRole(nextRole: 'child' | 'parent') {
  role.value = nextRole
  credential.value = ''
  authError.value = ''
}

function attemptIdFor(questionId: string): string {
  if (!attemptIds.value[questionId]) {
    attemptIds.value[questionId] = crypto.randomUUID()
  }
  return attemptIds.value[questionId]
}

async function beginCurrentQuestion() {
  const question = currentQuestion.value
  if (!question || !training.value) return
  const attemptId = attemptIdFor(question.id)
  if (!navigator.onLine) {
    actionError.value =
      '当前处于离线状态，可以作答；答案会在联网后由服务端判定。'
    await persistChildWorkspace()
    return
  }
  try {
    const result = await startTrainingAttempt({
      attemptId,
      questionId: question.id,
    })
    training.value.budget = result.budget
    await persistChildWorkspace()
  } catch (error) {
    actionError.value =
      error instanceof Error ? error.message : '暂时无法开始这道题'
    if (!shouldQueueOffline(error)) throw error
  }
}

async function submitAnswer() {
  const question = currentQuestion.value
  if (!question || !selectedAnswer.value || loading.value) return

  loading.value = true
  actionError.value = ''
  const attemptId = attemptIdFor(question.id)
  const submissionId = crypto.randomUUID()
  try {
    const result = await checkAnswer({
      submissionId,
      attemptId,
      questionId: question.id,
      answer: selectedAnswer.value,
    })
    if (training.value) training.value.budget = result.budget
    await enqueueEvent({
      type: 'answer_submitted',
      businessKey: `${attemptId}:${question.id}`,
      kpIds: [question.kpId],
      payload: {
        attemptId,
        questionId: question.id,
        answer: selectedAnswer.value,
        elapsedMs: elapsedSeconds.value * 1000,
      },
    })
    feedback.value = result.correct ? 'correct' : 'wrong'
    gradingFeedback.value = result.feedback ?? ''
    pendingAnswerQuestionId.value = ''
    await persistChildWorkspace()
    await runSync()
  } catch (error) {
    if (shouldQueueOffline(error)) {
      await enqueuePendingAnswer({
        submissionId,
        attemptId,
        questionId: question.id,
        answer: selectedAnswer.value,
        kpId: question.kpId,
        elapsedMs: elapsedSeconds.value * 1000,
      })
      await enqueueEvent({
        type: 'answer_submitted',
        businessKey: submissionId,
        kpIds: [question.kpId],
        payload: {
          submissionId,
          attemptId,
          questionId: question.id,
          answer: selectedAnswer.value,
          elapsedMs: elapsedSeconds.value * 1000,
          pendingCheck: true,
        },
      })
      pendingAnswerQuestionId.value = question.id
      actionError.value = '答案已离线保存，联网后会自动判题。'
      syncCount.value = await pendingCount()
      await persistChildWorkspace()
    } else {
      actionError.value =
        error instanceof Error ? error.message : '暂时无法检查答案'
    }
  } finally {
    loading.value = false
  }
}

async function askForHint() {
  const question = currentQuestion.value
  if (!question || loading.value) return

  loading.value = true
  hintLoading.value = true
  actionError.value = ''
  const attemptId = attemptIdFor(question.id)
  try {
    await enqueueEvent({
      type: 'hint_requested',
      kpIds: [question.kpId],
      payload: { attemptId, questionId: question.id },
    })
    const result = await requestHint({
      attemptId,
      questionId: question.id,
      selectedAnswer:
        question.questionType === 'subjective'
          ? 'A'
          : (selectedAnswer.value as 'A' | 'B' | 'C' | 'D'),
      kidInput:
        question.questionType === 'subjective'
          ? selectedAnswer.value
          : `我选择了 ${selectedAnswer.value || '未作答'}，还没有想明白。`,
    })
    hint.value = { text: result.text, level: result.hintLevel }
    await enqueueEvent({
      type: 'hint_used',
      kpIds: [question.kpId],
      payload: {
        attemptId,
        questionId: question.id,
        level: result.hintLevel,
        guideAttemptId: result.guideAttemptId,
      },
    })
    await runSync()
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : '提示暂时不可用'
  } finally {
    hintLoading.value = false
    loading.value = false
  }
}

async function nextQuestion() {
  if (!training.value) return
  if (
    training.value.budget.stopAddingQuestions ||
    training.value.budget.sessionClosed
  ) {
    await completeTraining()
    return
  }
  questionIndex.value += 1
  selectedAnswer.value = ''
  feedback.value = 'idle'
  gradingFeedback.value = ''
  hint.value = null
  actionError.value = ''
  pendingAnswerQuestionId.value = ''

  if (trainingComplete.value) await completeTraining()
  else {
    await persistChildWorkspace()
    await beginCurrentQuestion()
  }
}

async function completeTraining() {
  if (!training.value) return
  questionIndex.value = training.value.questions.length
  if (timer) window.clearInterval(timer)
  await enqueueEvent({
    type: 'training_completed',
    businessKey: training.value.planId,
    payload: {
      planId: training.value.planId,
      elapsedMs: elapsedSeconds.value * 1000,
      sessionClosed: training.value.budget.sessionClosed,
    },
  })
  await persistChildWorkspace()
  await runSync()
}

function retryQuestion() {
  if (currentQuestion.value?.questionType !== 'subjective') {
    selectedAnswer.value = ''
  }
  feedback.value = 'idle'
  gradingFeedback.value = ''
}

async function runSync() {
  if (syncActive.value || !navigator.onLine) {
    syncCount.value = await pendingCount()
    return
  }
  syncActive.value = true
  try {
    const answers = await syncPendingAnswers()
    for (const resolved of answers.resolved) {
      if (resolved.questionId !== currentQuestion.value?.id) continue
      if (training.value) training.value.budget = resolved.budget
      feedback.value = resolved.correct ? 'correct' : 'wrong'
      gradingFeedback.value = resolved.feedback ?? ''
      pendingAnswerQuestionId.value = ''
      actionError.value = ''
    }
    await syncOutbox()
    syncCount.value = await pendingCount()
    await persistChildWorkspace()
  } finally {
    syncActive.value = false
  }
}
</script>

<template>
  <div v-if="!authReady" class="center-state">
    <div class="loader" aria-label="正在加载" />
  </div>

  <main v-else-if="!session" class="login-shell">
    <section class="login-panel" aria-labelledby="login-title">
      <div class="brand-mark"><BookOpen :size="24" /></div>
      <p class="eyebrow">家庭学习</p>
      <h1 id="login-title">今天，从自己想明白开始</h1>
      <p class="login-copy">选择使用身份进入今日学习。</p>

      <div class="role-switch" aria-label="选择身份">
        <button
          :class="{ active: role === 'child' }"
          type="button"
          @click="setRole('child')"
        >
          孩子
        </button>
        <button
          :class="{ active: role === 'parent' }"
          type="button"
          @click="setRole('parent')"
        >
          家长
        </button>
      </div>

      <form @submit.prevent="handleLogin">
        <label for="credential">{{ role === 'child' ? '学习 PIN' : '家长密码' }}</label>
        <input
          id="credential"
          v-model="credential"
          type="password"
          autocomplete="current-password"
          :inputmode="role === 'child' ? 'numeric' : 'text'"
        />
        <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
        <button class="primary-button" type="submit" :disabled="loading">
          <span>{{ loading ? '正在进入' : '进入' }}</span>
          <ArrowRight :size="18" />
        </button>
      </form>
    </section>
  </main>

  <div v-else class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark small"><BookOpen :size="18" /></span>
        <span>家庭学习</span>
      </div>
      <div class="topbar-actions">
        <div
          v-if="session.role === 'child'"
          class="child-view-switch"
          aria-label="学习视图"
        >
          <button
            type="button"
            :class="{ active: childMode === 'training' }"
            @click="openChildMode('training')"
          >
            <ClipboardCheck :size="16" />
            今日训练
          </button>
          <button
            type="button"
            :class="{ active: childMode === 'tasks' }"
            @click="openChildMode('tasks')"
          >
            <ListTodo :size="16" />
            我的任务
          </button>
          <button
            type="button"
            :class="{ active: childMode === 'wrongBook' }"
            @click="openChildMode('wrongBook')"
          >
            <BookMarked :size="16" />
            错题复习
          </button>
          <button
            type="button"
            :class="{ active: childMode === 'words' }"
            @click="openChildMode('words')"
          >
            <Languages :size="16" />
            单词考察
          </button>
        </div>
        <button
          class="sync-button"
          type="button"
          :title="syncCount ? '点击重试同步' : '数据已同步'"
          @click="runSync"
        >
          <CloudOff v-if="syncCount" :size="17" />
          <Cloud v-else :size="17" />
          <span>{{ syncCount ? `${syncCount} 条待同步` : '已同步' }}</span>
        </button>
        <button class="icon-button" type="button" title="退出" @click="handleLogout">
          <LogOut :size="18" />
        </button>
      </div>
    </header>

    <main v-if="session.role === 'parent'" class="parent-view">
      <div class="page-heading">
        <div>
          <p class="eyebrow">家长工作台</p>
          <h1>
            {{
              parentMode === 'assessment'
                ? '发起学习考察'
                : parentMode === 'planning'
                  ? '计划与周报'
                : parentMode === 'content'
                  ? '教材知识库'
                  : parentMode === 'wrongBook'
                    ? '错题集'
                  : parentMode === 'words'
                    ? '英语单词考察'
                  : parentMode === 'models'
                    ? '模型能力配置'
                    : '本周学习证据'
            }}
          </h1>
        </div>
        <div class="identity"><UserRound :size="18" /> 家长</div>
      </div>

      <div class="parent-tabs" aria-label="家长工作台视图">
        <button
          type="button"
          :class="{ active: parentMode === 'models' }"
          @click="parentMode = 'models'"
        >
          <Settings :size="17" />
          模型配置
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'assessment' }"
          @click="parentMode = 'assessment'"
        >
          <ClipboardCheck :size="17" />
          发起考察
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'planning' }"
          @click="openParentMode('planning')"
        >
          <ListTodo :size="17" />
          计划与周报
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'content' }"
          @click="parentMode = 'content'"
        >
          <Database :size="17" />
          内容管理
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'wrongBook' }"
          @click="openParentMode('wrongBook')"
        >
          <BookMarked :size="17" />
          错题集
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'words' }"
          @click="openParentMode('words')"
        >
          <Languages :size="17" />
          单词考察
        </button>
        <button
          type="button"
          :class="{ active: parentMode === 'review' }"
          @click="openParentMode('review')"
        >
          <ShieldCheck :size="17" />
          学习复核
        </button>
      </div>

      <template v-if="parentMode === 'assessment'">
        <p v-if="contentError" class="form-error content-notice" role="alert">
          {{ contentError }}
        </p>
        <p v-if="contentMessage" class="success-message content-notice" role="status">
          {{ contentMessage }}
        </p>

        <section class="assessment-launcher">
          <div class="section-heading">
            <div>
              <p class="eyebrow">家长主动发起</p>
              <h2>跨章节组题与组卷</h2>
              <p>所有新题均取同年级同知识范围内难度前 30%。</p>
            </div>
          </div>
          <div class="paper-mode" aria-label="组卷模式">
            <button
              type="button"
              :class="{ active: assessmentDeliveryMode === 'weekend_paper' }"
              @click="assessmentDeliveryMode = 'weekend_paper'"
            >
              <FileText :size="18" />
              <span>
                <strong>周末综合卷</strong>
                <small>以解答题、证明题等大题为主</small>
              </span>
            </button>
            <button
              type="button"
              :class="{ active: assessmentDeliveryMode === 'passport' }"
              @click="assessmentDeliveryMode = 'passport'"
            >
              <ClipboardCheck :size="18" />
              <span>
                <strong>Passport 快练</strong>
                <small>全客观题，便于 AI Passport 作答</small>
              </span>
            </button>
          </div>
          <div class="selected-kp-enumeration" aria-live="polite">
            <div class="selected-kp-heading">
              <div>
                <strong>已选知识点</strong>
                <span v-if="selectedAssessmentKnowledgePoints.length">
                  {{ selectedAssessmentKnowledgePoints.length }} 项 ·
                  跨 {{ selectedAssessmentChapterCount }} 个章节
                </span>
                <span v-else>可从不同章节连续添加</span>
              </div>
            </div>
            <ol
              v-if="selectedAssessmentKnowledgePoints.length"
              class="selected-kp-list"
            >
              <li
                v-for="(item, index) in selectedAssessmentKnowledgePoints"
                :key="item.id"
              >
                <span class="selected-kp-index">{{ index + 1 }}</span>
                <span class="selected-kp-content">
                  <small>{{ item.chapterTitle }}</small>
                  <strong>{{ item.name }}</strong>
                </span>
                <button
                  type="button"
                  :aria-label="`删除知识点：${item.name}`"
                  :title="`删除 ${item.name}`"
                  @click="removeKnowledgePoint(item.id)"
                >
                  <X :size="16" />
                </button>
              </li>
            </ol>
            <p v-else class="selected-kp-empty">
              尚未选择知识点。使用下方筛选器定位章节，再逐项加入。
            </p>
          </div>
          <div
            v-if="publishedKnowledgePointCount"
            class="assessment-filters"
            aria-label="知识点筛选"
          >
            <label>
              <span>年级</span>
              <select
                v-model="selectedAssessmentGrade"
                @change="changeAssessmentGrade"
              >
                <option
                  v-for="grade in assessmentGradeOptions"
                  :key="grade"
                  :value="grade"
                >
                  {{ grade }}
                </option>
              </select>
            </label>
            <label>
              <span>学科</span>
              <select
                v-model="selectedAssessmentSubject"
                @change="changeAssessmentSubject"
              >
                <option
                  v-for="subject in assessmentSubjectOptions"
                  :key="subject"
                  :value="subject"
                >
                  {{ subject }}
                </option>
              </select>
            </label>
            <label>
              <span>章节</span>
              <select
                v-model="selectedAssessmentChapter"
                @change="changeAssessmentChapter"
              >
                <option
                  v-for="chapter in assessmentChapterOptions"
                  :key="chapter"
                  :value="chapter"
                >
                  {{ chapter }}
                </option>
              </select>
            </label>
          </div>
          <div
            v-if="filteredAssessmentKnowledgePoints.length"
            class="kp-selector"
          >
            <button
              v-for="item in filteredAssessmentKnowledgePoints"
              :key="item.id"
              type="button"
              :class="{ selected: selectedKnowledgePointIds.includes(item.id) }"
              @click="toggleKnowledgePoint(item.id)"
            >
              <span>
                {{ item.code }} ·
                {{ formatPageRange(item.sourcePageStart, item.sourcePageEnd) }}
              </span>
              <strong>{{ item.name }}</strong>
              <small
                v-if="recommendationReasons[item.id]?.length"
                class="recommendation-reason"
              >
                {{ recommendationReasons[item.id].join(' · ') }}
              </small>
              <Check
                v-if="selectedKnowledgePointIds.includes(item.id)"
                :size="17"
              />
            </button>
          </div>
          <div v-else-if="!publishedKnowledgePointCount" class="inline-empty">
            请先在教材知识库中导入并确认教材。
          </div>
          <div v-else class="inline-empty">当前筛选条件下暂无知识点。</div>
          <div class="selection-actions">
            <span>已跨章节选择 {{ selectedKnowledgePointIds.length }} 个知识点</span>
            <button
              class="secondary-button compact"
              type="button"
              :disabled="creatingAssessment || !publishedKnowledgePointCount"
              @click="autoSelectKnowledgePoints"
            >
              <GitBranch :size="16" />
              自动圈选核心高热知识点
            </button>
          </div>
          <form class="assessment-form" @submit.prevent="assignAssessment">
            <label>
              <span>考察目的</span>
              <input
                v-model="assessmentPurpose"
                type="text"
                maxlength="200"
              />
            </label>
            <label>
              <span>题目数量</span>
              <select v-model.number="assessmentCount">
                <option :value="1">1 道</option>
                <option :value="2">2 道</option>
                <option :value="3">3 道</option>
                <option :value="4">4 道</option>
                <option :value="5">5 道</option>
                <option :value="6">6 道</option>
                <option :value="7">7 道</option>
                <option :value="8">8 道</option>
              </select>
            </label>
            <button
              class="primary-button compact no-margin"
              type="submit"
              :disabled="
                !selectedKnowledgePointIds.length ||
                !assessmentPurpose.trim() ||
                creatingAssessment ||
                !content?.assessmentConfigured
              "
            >
              <ClipboardCheck :size="17" />
              {{ creatingAssessment ? '正在生成' : '生成并下发' }}
            </button>
          </form>
          <p v-if="!content?.assessmentConfigured" class="configuration-state">
            动态出题需要先启用 Chat 模型
          </p>
        </section>

        <section class="routine-band">
          <div>
            <TimerReset :size="21" />
            <div>
              <h2>例行考察</h2>
              <p>根据近期学习内容和证据，自动选择需要复验的知识点。</p>
            </div>
          </div>
          <button
            class="secondary-button"
            type="button"
            :disabled="creatingAssessment || !content?.assessmentConfigured"
            @click="assignRoutineAssessment"
          >
            立即运行一次
          </button>
        </section>

        <section class="content-section">
          <div class="section-heading">
            <div>
              <h2>最近下发</h2>
              <p>题目只在考察触发时生成，不在教材导入时预制。</p>
            </div>
          </div>
          <div v-if="assessments.length" class="assessment-list">
            <article v-for="item in assessments" :key="item.id">
              <span>{{ item.trigger === 'routine' ? '例行' : '家长发起' }}</span>
              <div>
                <strong>{{ item.purpose }}</strong>
                <small>
                  {{
                    item.deliveryMode === 'weekend_paper'
                      ? '周末综合卷'
                      : 'Passport 快练'
                  }}
                  · {{ item.questionIds.length }} 道题 ·
                  {{ new Date(item.assignedAt).toLocaleString('zh-CN') }}
                </small>
              </div>
              <CheckCircle2 :size="19" />
            </article>
          </div>
          <div v-else class="inline-empty">尚未下发考察。</div>
        </section>
      </template>

      <template v-else-if="parentMode === 'content'">
        <section class="import-band">
          <div class="import-heading">
            <div class="import-icon"><Upload :size="22" /></div>
            <div>
              <h2>导入数学教材</h2>
              <p>原生电子版 PDF · 自动提取章节、知识点与前置关系</p>
            </div>
          </div>
          <form class="upload-form" @submit.prevent="importTextbook">
            <label class="file-picker" for="textbook-file">
              <FileText :size="18" />
              <span>{{ selectedTextbook?.name ?? '选择教材 PDF' }}</span>
              <input
                id="textbook-file"
                ref="textbookInput"
                type="file"
                accept="application/pdf,.pdf"
                @change="chooseTextbook"
              />
            </label>
            <button
              class="primary-button compact no-margin"
              type="submit"
              :disabled="
                !selectedTextbook ||
                importingTextbook ||
                !textbookChatConfigured
              "
            >
              <span>{{ importingTextbook ? '正在梳理教材' : '开始自动梳理' }}</span>
              <Upload :size="17" />
            </button>
          </form>
          <div
            v-if="textbookProgress"
            class="textbook-progress"
            :class="{ failed: textbookProgress.status === 'failed' }"
            aria-live="polite"
          >
            <div class="textbook-progress-heading">
              <div>
                <strong>{{ textbookProgress.message }}</strong>
                <span>
                  {{ textbookProgress.fileName }}
                  <template
                    v-if="
                      textbookProgress.status === 'analyzing' &&
                      textbookProgress.totalChunks
                    "
                  >
                    · {{ textbookProgress.completedChunks }}/{{
                      textbookProgress.totalChunks
                    }}
                    个分块
                  </template>
                </span>
              </div>
              <strong>{{ textbookProgress.percent }}%</strong>
            </div>
            <div
              class="textbook-progress-track"
              role="progressbar"
              :aria-valuenow="textbookProgress.percent"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-label="textbookProgress.message"
            >
              <span :style="{ width: `${textbookProgress.percent}%` }" />
            </div>
          </div>
          <p v-if="!textbookChatConfigured" class="configuration-state">
            教材梳理需要 Chat 模型；Embedding 仅用于语义检索
          </p>
        </section>

        <section class="summary-band content-summary">
          <div>
            <span>已发布知识点</span>
            <strong>{{ publishedKnowledgePointCount }}</strong>
            <small>来自已确认教材</small>
          </div>
          <div>
            <span>动态考察</span>
            <strong>{{ assessments.length }}</strong>
            <small>次已下发</small>
          </div>
          <div>
            <span>教材导入</span>
            <strong>{{ textbookImports.length }}</strong>
            <small>册</small>
          </div>
        </section>

        <p v-if="contentError" class="form-error content-notice" role="alert">
          {{ contentError }}
        </p>
        <p v-if="contentMessage" class="success-message content-notice" role="status">
          {{ contentMessage }}
        </p>

        <section v-if="activeTextbookImport" class="content-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">
                {{
                  activeTextbookImport.status === 'confirmed'
                    ? '已确认'
                    : '待确认'
                }}
              </p>
              <h2>{{ activeTextbookImport.draft.title }}</h2>
              <p>
                {{ activeTextbookImport.draft.edition }} ·
                {{ activeTextbookImport.draft.grade }} ·
                {{ activeTextbookImport.pageCount }} 页
              </p>
            </div>
            <button
              v-if="activeTextbookImport.status === 'ready_for_review'"
              class="primary-button compact no-margin"
              type="button"
              :disabled="contentLoading"
              @click="confirmActiveTextbook"
            >
              <Check :size="17" />
              确认并发布
            </button>
          </div>

          <div class="draft-metrics">
            <div>
              <strong>{{ activeTextbookImport.draft.chapters.length }}</strong>
              <span>章节</span>
            </div>
            <div>
              <strong>{{ draftKnowledgePointCount }}</strong>
              <span>知识点</span>
            </div>
          </div>

          <div class="chapter-list">
            <section
              v-for="chapter in sortedTextbookChapters"
              :key="chapter.code"
              class="chapter-block"
            >
              <div class="chapter-heading">
                <div>
                  <span>{{ chapter.code }}</span>
                  <h3>{{ chapter.title }}</h3>
                </div>
                <small>{{
                  formatPageRange(chapter.pageStart, chapter.pageEnd)
                }}</small>
              </div>
              <div class="draft-kp-list">
                <article
                  v-for="knowledgePoint in chapter.knowledgePoints"
                  :key="knowledgePoint.code"
                >
                  <div class="kp-title">
                    <strong>{{ knowledgePoint.name }}</strong>
                    <span>{{ knowledgePoint.code }}</span>
                  </div>
                  <p>{{ knowledgePoint.summary }}</p>
                  <div class="kp-meta">
                    <span>{{
                      formatPageRange(
                        knowledgePoint.pageStart,
                        knowledgePoint.pageEnd,
                      )
                    }}</span>
                    <span>
                      <GitBranch :size="14" />
                      {{
                        knowledgePoint.prerequisiteCodes.length
                          ? knowledgePoint.prerequisiteCodes.join('、')
                          : '无前置知识点'
                      }}
                    </span>
                  </div>
                </article>
              </div>
            </section>
          </div>
        </section>

        <section v-else class="empty-state compact-empty">
          <FileText :size="30" />
          <h2>尚未导入教材</h2>
          <p>选择数学教材 PDF 后，系统会自动生成待确认知识结构。</p>
        </section>

        <section v-if="content?.knowledgePoints.length" class="content-section">
          <div class="section-heading">
            <div>
              <h2>已发布内容</h2>
              <p>供动态考察生成使用的教材知识结构。</p>
            </div>
          </div>
          <div class="knowledge-list">
            <div
              v-for="item in sortedPublishedKnowledgePoints"
              :key="item.id"
              class="knowledge-row"
            >
              <span class="status-dot" :class="item.status" />
              <strong>{{ item.name }}</strong>
              <span>{{ item.code }}</span>
              <span>{{ item.chapter }}</span>
              <span>{{
                formatPageRange(item.sourcePageStart, item.sourcePageEnd)
              }}</span>
              <small>{{ item.status === 'published' ? '已发布' : '草稿' }}</small>
            </div>
          </div>
        </section>
      </template>

      <template v-else-if="parentMode === 'planning'">
        <p v-if="planningError" class="form-error content-notice" role="alert">
          {{ planningError }}
        </p>
        <p
          v-if="planningMessage"
          class="success-message content-notice"
          role="status"
        >
          {{ planningMessage }}
        </p>

        <section v-if="planningLoading" class="empty-state compact-empty">
          <div class="loader" aria-label="正在加载学习计划" />
        </section>

        <template v-else>
          <section class="planning-summary">
            <div>
              <span>计划用时</span>
              <strong>{{ taskSnapshot?.workload.plannedMinutes ?? 0 }}</strong>
              <small>分钟</small>
            </div>
            <div>
              <span>建议用时</span>
              <strong>{{ taskSnapshot?.workload.recommendedMinutes ?? 0 }}</strong>
              <small>分钟</small>
            </div>
            <div>
              <span>逾期任务</span>
              <strong>{{ taskSnapshot?.workload.overdueCount ?? 0 }}</strong>
              <small>项</small>
            </div>
            <p v-if="taskSnapshot?.workload.reduced">
              今日任务已按当前工作量自动缩减。
            </p>
          </section>

          <div class="planning-columns">
            <section class="planning-section">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">任务中心</p>
                  <h2>下发并核验学习任务</h2>
                  <p>孩子提交完成后，由家长核验；系统会按总工作量自动缩减建议时长。</p>
                </div>
              </div>

              <form class="planning-form" @submit.prevent="submitTaskDraft">
                <label>
                  <span>来源</span>
                  <select v-model="taskDraft.source">
                    <option value="parent">家长</option>
                    <option value="school">学校</option>
                  </select>
                </label>
                <label>
                  <span>类型</span>
                  <select v-model="taskDraft.kind">
                    <option value="homework">作业</option>
                    <option value="preview">预习</option>
                    <option value="review">复习</option>
                    <option value="practice">练习</option>
                    <option value="carry_reminder">携带提醒</option>
                  </select>
                </label>
                <label class="field-wide">
                  <span>任务标题</span>
                  <input
                    v-model="taskDraft.title"
                    maxlength="120"
                    placeholder="例如：完成第三章课后练习"
                    required
                  />
                </label>
                <label class="field-wide">
                  <span>说明</span>
                  <textarea
                    v-model="taskDraft.description"
                    rows="2"
                    maxlength="1000"
                    placeholder="补充完成要求或携带物品"
                  />
                </label>
                <label>
                  <span>科目</span>
                  <input v-model="taskDraft.subject" maxlength="30" required />
                </label>
                <label>
                  <span>知识点</span>
                  <select v-model="taskDraft.kpId">
                    <option value="">不指定</option>
                    <option
                      v-for="item in assessmentKnowledgePoints"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.chapterTitle }} · {{ item.name }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>截止时间</span>
                  <input v-model="taskDraft.dueAt" type="datetime-local" />
                </label>
                <label>
                  <span>预计分钟</span>
                  <input
                    v-model.number="taskDraft.estimatedMinutes"
                    type="number"
                    min="1"
                    max="240"
                  />
                </label>
                <label>
                  <span>优先级</span>
                  <select v-model.number="taskDraft.priority">
                    <option :value="1">普通</option>
                    <option :value="2">重要</option>
                    <option :value="3">优先</option>
                  </select>
                </label>
                <button
                  class="primary-button compact no-margin"
                  type="submit"
                  :disabled="!taskDraft.title.trim() || savingPlanningItem"
                >
                  <ListTodo :size="17" />
                  {{ savingPlanningItem ? '保存中' : '下发任务' }}
                </button>
              </form>

              <div v-if="taskSnapshot?.tasks.length" class="task-list">
                <article v-for="task in taskSnapshot.tasks" :key="task.id">
                  <div class="task-heading">
                    <div>
                      <span>{{ task.subject }} · {{ task.kind }}</span>
                      <h3>{{ task.title }}</h3>
                    </div>
                    <span class="task-status" :class="task.status">
                      {{
                        task.status === 'pending'
                          ? '待完成'
                          : task.status === 'claimed_done'
                            ? '待核验'
                            : task.status === 'verified'
                              ? '已完成'
                              : '已取消'
                      }}
                    </span>
                  </div>
                  <p v-if="task.description">{{ task.description }}</p>
                  <small>
                    预计 {{ task.estimatedMinutes }} 分钟
                    <template v-if="task.dueAt">
                      · 截止
                      {{ new Date(task.dueAt).toLocaleString('zh-CN') }}
                    </template>
                  </small>
                  <div class="task-actions">
                    <button
                      v-if="task.status === 'claimed_done'"
                      class="primary-button compact no-margin"
                      type="button"
                      :disabled="savingPlanningItem"
                      @click="updateTaskState(task, 'verified')"
                    >
                      <CheckCircle2 :size="16" />
                      核验完成
                    </button>
                    <button
                      v-if="task.status === 'verified'"
                      class="secondary-button compact"
                      type="button"
                      :disabled="savingPlanningItem"
                      @click="updateTaskState(task, 'pending')"
                    >
                      <RotateCcw :size="16" />
                      重新打开
                    </button>
                    <button
                      v-if="task.status !== 'cancelled'"
                      class="secondary-button compact"
                      type="button"
                      :disabled="savingPlanningItem"
                      @click="updateTaskState(task, 'cancelled')"
                    >
                      取消
                    </button>
                  </div>
                </article>
              </div>
              <div v-else class="empty-state compact-empty">
                <ListTodo :size="30" />
                <h2>还没有学习任务</h2>
              </div>
            </section>

            <section class="planning-section">
              <div class="section-heading">
                <div>
                  <p class="eyebrow">教学进度</p>
                  <h2>映射当前教学章节</h2>
                  <p>确认知识点映射后，系统会自动生成课前预习任务。</p>
                </div>
              </div>

              <form class="planning-form progress-form" @submit.prevent="submitProgressDraft">
                <label>
                  <span>科目</span>
                  <input v-model="progressDraft.subject" maxlength="30" required />
                </label>
                <label class="field-wide">
                  <span>当前章节</span>
                  <input
                    v-model="progressDraft.chapter"
                    maxlength="120"
                    placeholder="例如：第三章 一元一次方程"
                    required
                  />
                </label>
                <label>
                  <span>生效日期</span>
                  <input v-model="progressDraft.effectiveDate" type="date" />
                </label>
                <label class="field-wide">
                  <span>知识点映射</span>
                  <select v-model="progressDraft.kpId">
                    <option value="">稍后确认</option>
                    <option
                      v-for="item in assessmentKnowledgePoints"
                      :key="item.id"
                      :value="item.id"
                    >
                      {{ item.chapterTitle }} · {{ item.name }}
                    </option>
                  </select>
                </label>
                <button
                  class="primary-button compact no-margin"
                  type="submit"
                  :disabled="!progressDraft.chapter.trim() || savingPlanningItem"
                >
                  <CalendarDays :size="17" />
                  保存进度
                </button>
              </form>

              <div v-if="curriculumProgress.length" class="progress-list">
                <article v-for="item in curriculumProgress" :key="item.id">
                  <div>
                    <span>{{ item.subject }} · {{ item.effectiveDate }}</span>
                    <h3>{{ item.chapter }}</h3>
                  </div>
                  <span class="mapping-state" :class="item.mappingStatus">
                    {{ item.mappingStatus === 'confirmed' ? '已确认' : '待映射' }}
                  </span>
                  <div v-if="item.mappingStatus !== 'confirmed'" class="mapping-action">
                    <select v-model="progressMappingSelections[item.id]">
                      <option value="" disabled>选择对应知识点</option>
                      <option
                        v-for="knowledgePoint in assessmentKnowledgePoints"
                        :key="knowledgePoint.id"
                        :value="knowledgePoint.id"
                      >
                        {{ knowledgePoint.chapterTitle }} ·
                        {{ knowledgePoint.name }}
                      </option>
                    </select>
                    <button
                      class="secondary-button compact"
                      type="button"
                      :disabled="
                        !progressMappingSelections[item.id] || savingPlanningItem
                      "
                      @click="confirmProgressMapping(item)"
                    >
                      <Check :size="16" />
                      确认并生成预习
                    </button>
                  </div>
                </article>
              </div>
            </section>
          </div>

          <section v-if="weeklyReport" class="weekly-report">
            <div class="section-heading">
              <div>
                <p class="eyebrow">本周周报</p>
                <h2>趋势、重点与下一步建议</h2>
                <p>
                  {{ weeklyReport.period.from }} 至
                  {{ weeklyReport.period.to }}
                </p>
              </div>
              <span class="trend-badge" :class="weeklyReport.trend.direction">
                {{
                  weeklyReport.trend.direction === 'up'
                    ? '正确率上升'
                    : weeklyReport.trend.direction === 'down'
                      ? '正确率下降'
                      : weeklyReport.trend.direction === 'flat'
                        ? '表现平稳'
                        : '样本不足'
                }}
              </span>
            </div>
            <div class="weekly-metrics">
              <div>
                <span>有效作答</span>
                <strong>{{ weeklyReport.overview.attempts }}</strong>
              </div>
              <div>
                <span>独立作答</span>
                <strong>{{ weeklyReport.overview.independentAttempts }}</strong>
              </div>
              <div>
                <span>正确率</span>
                <strong>
                  {{
                    weeklyReport.overview.accuracy === null
                      ? '—'
                      : `${Math.round(weeklyReport.overview.accuracy * 100)}%`
                  }}
                </strong>
              </div>
              <div>
                <span>已掌握</span>
                <strong>{{ weeklyReport.overview.mastered }}</strong>
              </div>
            </div>
            <div class="weekly-detail">
              <div>
                <h3>重点关注</h3>
                <ul v-if="weeklyReport.focus.length">
                  <li v-for="item in weeklyReport.focus" :key="item.kpId">
                    <strong>{{ item.name }}</strong>
                    <span>
                      提示依赖
                      {{ Math.round(item.hintDependence * 100) }}%
                    </span>
                  </li>
                </ul>
                <p v-else>本周暂无需要重点干预的知识点。</p>
              </div>
              <div>
                <h3>建议</h3>
                <ul>
                  <li
                    v-for="suggestion in weeklyReport.suggestions"
                    :key="suggestion"
                  >
                    {{ suggestion }}
                  </li>
                </ul>
              </div>
            </div>
          </section>
        </template>
      </template>

      <template v-else-if="parentMode === 'wrongBook'">
        <section class="wrong-photo-band">
          <div class="section-heading">
            <div>
              <p class="eyebrow">拍照录入</p>
              <h2>识别纸面错题</h2>
              <p>保留原图，并自动匹配已发布教材知识点。</p>
            </div>
          </div>
          <form class="upload-form" @submit.prevent="uploadWrongPhoto">
            <label class="file-picker" for="wrong-photo">
              <Camera :size="18" />
              <span>{{ selectedWrongPhoto?.name ?? '选择错题照片' }}</span>
              <input
                id="wrong-photo"
                ref="wrongPhotoInput"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                @change="chooseWrongPhoto"
              />
            </label>
            <button
              class="primary-button compact no-margin"
              type="submit"
              :disabled="
                !selectedWrongPhoto ||
                uploadingWrongPhoto ||
                !wrongBook?.photoRecognitionConfigured
              "
            >
              <RefreshCw
                v-if="uploadingWrongPhoto"
                class="spinning"
                :size="17"
              />
              <Camera v-else :size="17" />
              {{ uploadingWrongPhoto ? '正在识别并映射' : '识别并加入' }}
            </button>
          </form>
          <p
            v-if="wrongBook && !wrongBook.photoRecognitionConfigured"
            class="configuration-state"
          >
            拍照识别需要先启用 Vision 模型
          </p>
        </section>

        <p v-if="wrongBookError" class="form-error content-notice" role="alert">
          {{ wrongBookError }}
        </p>
        <p
          v-if="wrongBookMessage"
          class="success-message content-notice"
          role="status"
        >
          {{ wrongBookMessage }}
        </p>

        <section class="wrong-book-section">
          <div class="section-heading">
            <div>
              <h2>错题管理</h2>
              <p>系统答错自动归档，照片错题需确认知识点映射。</p>
            </div>
            <label class="status-filter">
              <span>状态</span>
              <select v-model="wrongBookStatus" @change="loadWrongBook">
                <option value="active">待复习</option>
                <option value="mastered">已掌握</option>
                <option value="archived">已归档</option>
                <option value="all">全部</option>
              </select>
            </label>
          </div>

          <div v-if="wrongBookLoading" class="empty-state compact-empty">
            <div class="loader" aria-label="正在加载错题集" />
          </div>
          <div v-else-if="wrongBook?.items.length" class="wrong-item-list">
            <article
              v-for="item in wrongBook.items"
              :key="item.id"
              class="wrong-item"
            >
              <div class="wrong-item-main">
                <img
                  v-if="item.hasPhoto"
                  class="wrong-photo"
                  :src="item.photoUrl || `/api/v1/wrong-items/${item.id}/photo`"
                  alt="错题原图"
                />
                <div class="wrong-item-copy">
                  <div class="wrong-item-badges">
                    <span>{{ item.source === 'photo' ? '拍照录入' : '系统答错' }}</span>
                    <span :class="item.status">
                      {{ wrongItemStatusLabel(item.status) }}
                    </span>
                    <span v-if="!item.mappingConfirmed" class="pending">
                      映射待确认
                    </span>
                  </div>
                  <h3>{{ item.stem }}</h3>
                  <p v-if="item.studentAnswer">
                    <strong>最近错误：</strong>{{ item.studentAnswer }}
                  </p>
                  <p v-if="item.answerKey">
                    <strong>参考答案：</strong>{{ item.answerKey }}
                  </p>
                  <p v-if="item.analysis" class="wrong-analysis">
                    {{ item.analysis }}
                  </p>
                  <small>
                    错误 {{ item.wrongCount }} 次 · 最近
                    {{ new Date(item.latestWrongAt).toLocaleString('zh-CN') }}
                  </small>
                </div>
              </div>

              <div
                v-if="wrongItemDrafts[item.id]"
                class="wrong-item-editor"
              >
                <label>
                  <span>知识点</span>
                  <select v-model="wrongItemDrafts[item.id]!.kpId">
                    <option value="" disabled>请选择知识点</option>
                    <option
                      v-for="knowledgePoint in assessmentKnowledgePoints"
                      :key="knowledgePoint.id"
                      :value="knowledgePoint.id"
                    >
                      {{ knowledgePoint.chapterTitle }} ·
                      {{ knowledgePoint.name }}
                    </option>
                  </select>
                </label>
                <label>
                  <span>标签</span>
                  <input
                    v-model="wrongItemDrafts[item.id]!.tags"
                    type="text"
                    maxlength="300"
                    placeholder="计算、审题"
                  />
                </label>
                <label class="wrong-note">
                  <span>备注</span>
                  <textarea
                    v-model="wrongItemDrafts[item.id]!.note"
                    rows="2"
                    maxlength="1000"
                  />
                </label>
              </div>

              <div class="wrong-item-actions">
                <button
                  class="secondary-button compact"
                  type="button"
                  :disabled="Boolean(savingWrongItemId)"
                  @click="saveWrongItem(item)"
                >
                  <Check :size="16" />
                  {{ savingWrongItemId === item.id ? '保存中' : '保存' }}
                </button>
                <button
                  v-if="item.status !== 'mastered'"
                  class="secondary-button compact"
                  type="button"
                  :disabled="Boolean(savingWrongItemId)"
                  @click="setWrongItemStatus(item, 'mastered')"
                >
                  <CheckCircle2 :size="16" />
                  标为掌握
                </button>
                <button
                  v-if="item.status !== 'archived'"
                  class="secondary-button compact"
                  type="button"
                  :disabled="Boolean(savingWrongItemId)"
                  @click="setWrongItemStatus(item, 'archived')"
                >
                  <Archive :size="16" />
                  归档
                </button>
                <button
                  v-if="item.status !== 'active'"
                  class="secondary-button compact"
                  type="button"
                  :disabled="Boolean(savingWrongItemId)"
                  @click="setWrongItemStatus(item, 'active')"
                >
                  <RotateCcw :size="16" />
                  恢复复习
                </button>
                <button
                  class="icon-button danger"
                  type="button"
                  title="删除错题"
                  :disabled="Boolean(savingWrongItemId)"
                  @click="removeWrongItem(item)"
                >
                  <Trash2 :size="17" />
                </button>
              </div>
            </article>
          </div>
          <section v-else class="empty-state compact-empty">
            <BookMarked :size="30" />
            <h2>当前没有错题</h2>
            <p>系统答错或拍照识别后会出现在这里。</p>
          </section>
        </section>
      </template>

      <template v-else-if="parentMode === 'words'">
        <p v-if="wordbookError" class="form-error content-notice" role="alert">
          {{ wordbookError }}
        </p>
        <p
          v-if="wordbookMessage"
          class="success-message content-notice"
          role="status"
        >
          {{ wordbookMessage }}
        </p>

        <section class="import-band">
          <div class="section-heading">
            <div>
              <p class="eyebrow">单词本</p>
              <h2>导入英语单词本</h2>
              <p>支持 PDF 与 Word（.docx），每行需包含英文单词与中文释义。</p>
            </div>
          </div>
          <form class="upload-form" @submit.prevent="handleWordbookUpload">
            <label class="file-picker" for="wordbook-file">
              <FileText :size="18" />
              <span>{{ wordbookFile?.name ?? '选择单词本文件' }}</span>
              <input
                id="wordbook-file"
                ref="wordbookInput"
                type="file"
                accept=".pdf,.docx"
                @change="handleWordbookFileChange"
              />
            </label>
            <button
              class="primary-button compact no-margin"
              type="submit"
              :disabled="!wordbookFile || uploadingWordbook"
            >
              <Upload :size="17" />
              <span>{{ uploadingWordbook ? '正在识别' : '上传并识别' }}</span>
            </button>
          </form>
        </section>

        <section class="content-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">词本列表</p>
              <h2>已导入的单词本</h2>
            </div>
            <span>{{ wordbooks.length }} 本</span>
          </div>
          <section v-if="wordbooksLoading" class="empty-state compact-empty">
            <div class="loader" aria-label="正在加载单词本" />
          </section>
          <div v-else-if="wordbooks.length" class="wrong-item-list">
            <article v-for="book in wordbooks" :key="book.id" class="wrong-item">
              <div class="task-heading">
                <div>
                  <span>{{ book.sourceType.toUpperCase() }}</span>
                  <h2>{{ book.name }}</h2>
                </div>
                <span class="task-status">
                  {{ book.status === 'confirmed' ? '已确认' : '待确认' }}
                </span>
              </div>
              <p>{{ book.entryCount }} 个词条 · {{ book.fileName }}</p>
              <div class="wrong-item-actions">
                <button class="secondary-button compact" type="button"
                  :disabled="Boolean(loadingWordbookId)"
                  @click="openWordbookReview(book)">
                  {{ loadingWordbookId === book.id ? '加载词条中' : book.status === 'confirmed' ? '查看词条' : '预览并校对' }}
                </button>
                <button
                  v-if="book.status !== 'confirmed' && reviewingWordbook?.id === book.id"
                  class="primary-button compact no-margin"
                  type="button"
                  :disabled="confirmingWordbookId === book.id || savingWordbook"
                  @click="handleConfirmWordbook(book)"
                >
                  <Check :size="16" />
                  {{ confirmingWordbookId === book.id ? '确认中' : '保存并确认词本' }}
                </button>
                <button
                  v-else-if="book.status === 'confirmed'"
                  class="ghost-button compact no-margin"
                  type="button"
                  @click="wordQuizBookId = book.id"
                >
                  <ClipboardCheck :size="16" />
                  选为考察词本
                </button>
                <button
                  class="icon-button"
                  type="button"
                  title="删除"
                  :disabled="deletingWordbookId === book.id"
                  @click="handleDeleteWordbook(book)"
                >
                  <Trash2 :size="16" />
                </button>
              </div>
              <section v-if="reviewingWordbook?.id === book.id" class="wordbook-review">
                <p>共 {{ reviewingWordbook.entries?.length ?? 0 }} 个词条。请核对英文、音标、词性与释义。</p>
                <div class="wordbook-review-table">
                  <table>
                    <thead><tr><th>英文</th><th>音标</th><th>词性</th><th>中文释义</th><th>操作</th></tr></thead>
                    <tbody>
                      <tr v-for="(entry, index) in reviewingWordbook.entries" :key="index">
                        <td><input v-model="entry.word" aria-label="英文" maxlength="80" :disabled="book.status === 'confirmed' || savingWordbook || Boolean(confirmingWordbookId)" /></td>
                        <td><input v-model="entry.phonetic" aria-label="音标" maxlength="60" :disabled="book.status === 'confirmed' || savingWordbook || Boolean(confirmingWordbookId)" /></td>
                        <td><input v-model="entry.partOfSpeech" aria-label="词性" maxlength="20" :disabled="book.status === 'confirmed' || savingWordbook || Boolean(confirmingWordbookId)" /></td>
                        <td><textarea v-model="entry.meaning" aria-label="中文释义" maxlength="300" :disabled="book.status === 'confirmed' || savingWordbook || Boolean(confirmingWordbookId)" /></td>
                        <td><button v-if="book.status !== 'confirmed'" class="icon-button" type="button" title="删除词条"
                          :disabled="savingWordbook || Boolean(confirmingWordbookId)"
                          @click="reviewingWordbook.entries?.splice(index, 1)"><X :size="16" /></button></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div class="wrong-item-actions">
                  <button v-if="book.status !== 'confirmed'" class="secondary-button" type="button"
                    :disabled="savingWordbook || Boolean(confirmingWordbookId) || (reviewingWordbook.entries?.length ?? 0) >= 2000"
                    @click="reviewingWordbook.entries?.push({ word: '', phonetic: '', partOfSpeech: '', meaning: '' })">添加词条</button>
                  <button v-if="book.status !== 'confirmed'" class="primary-button compact no-margin" type="button"
                    :disabled="savingWordbook || Boolean(confirmingWordbookId)" @click="saveWordbookReview">
                    {{ savingWordbook ? '保存中' : '保存校对' }}
                  </button>
                  <button class="ghost-button" type="button" :disabled="savingWordbook || Boolean(confirmingWordbookId)"
                    @click="reviewingWordbook = null">收起</button>
                </div>
              </section>
            </article>
          </div>
          <section v-else class="empty-state compact-empty">
            <Languages :size="30" />
            <h2>还没有单词本</h2>
            <p>上传 PDF 或 Word 词表后，系统会自动拆分出词条。</p>
          </section>
        </section>

        <section class="assessment-launcher">
          <div class="section-heading">
            <div>
              <p class="eyebrow">下发考察</p>
              <h2>用选择题考察单词掌握</h2>
              <p>题目由词表自动生成。随身设备联网获取后可离线作答，联网后同步评分。</p>
            </div>
          </div>
          <div class="assessment-filters">
            <label>
              <span>词本</span>
              <select v-model="wordQuizBookId">
                <option value="">请选择已确认的单词本</option>
                <option
                  v-for="book in confirmedWordbooks"
                  :key="book.id"
                  :value="book.id"
                >
                  {{ book.name }}（{{ book.entryCount }} 词）
                </option>
              </select>
            </label>
            <label>
              <span>题型</span>
              <select v-model="wordQuizDirection">
                <option value="en_to_zh">英译中（四选一）</option>
                <option value="zh_to_en">中译英（四选一）</option>
              </select>
            </label>
            <label>
              <span>题量</span>
              <select v-model.number="wordQuizCount">
                <option :value="10">10 题</option>
                <option :value="20">20 题</option>
                <option :value="30">30 题</option>
              </select>
            </label>
            <label>
              <span>作答方式</span>
              <select v-model="wordQuizDeliveryMode">
                <option value="passport">下发随身设备</option>
                <option value="web">网页端作答</option>
              </select>
            </label>
          </div>
          <button
            class="primary-button compact"
            type="button"
            :disabled="!wordQuizBookId || creatingWordQuiz"
            @click="handleCreateWordQuiz"
          >
            <ClipboardCheck :size="17" />
            {{ creatingWordQuiz ? '正在生成' : '生成考察' }}
          </button>
        </section>

        <section class="summary-band content-summary">
          <div>
            <span>{{ wordStats?.totalAnswers ?? 0 }}</span>
            <small>累计作答题数</small>
          </div>
          <div>
            <span>{{ wordAccuracyLabel }}</span>
            <small>单词正确率</small>
          </div>
          <div>
            <span>{{ wordStats?.wrongItems.active ?? 0 }}</span>
            <small>待巩固单词</small>
          </div>
          <div>
            <span>{{ wordStats?.wrongItems.mastered ?? 0 }}</span>
            <small>已掌握单词</small>
          </div>
        </section>

        <section class="content-section">
          <div class="section-heading">
            <div>
              <p class="eyebrow">单词错题本</p>
              <h2>需要再记一遍的单词</h2>
            </div>
            <label class="status-filter">
              <span>状态</span>
              <select :value="wordWrongStatus" @change="handleWordWrongStatusChange">
                <option value="active">待巩固</option>
                <option value="mastered">已掌握</option>
              </select>
            </label>
          </div>
          <section v-if="wordWrongLoading" class="empty-state compact-empty">
            <div class="loader" aria-label="正在加载单词错题" />
          </section>
          <div v-else-if="wordWrongItems.length" class="wrong-item-list">
            <article
              v-for="item in wordWrongItems"
              :key="item.id"
              class="wrong-item"
            >
              <div class="task-heading">
                <div>
                  <span>{{ item.wrongCount }} 次错误</span>
                  <h2>{{ item.word }}</h2>
                </div>
                <span class="task-status">
                  {{ item.status === 'active' ? '待巩固' : '已掌握' }}
                </span>
              </div>
              <p>
                {{ item.phonetic ? `/${item.phonetic}/ ` : '' }}{{ item.meaning }}
              </p>
              <div class="wrong-item-actions">
                <button
                  class="ghost-button compact no-margin"
                  type="button"
                  @click="
                    handleWordWrongStatus(
                      item,
                      item.status === 'active' ? 'mastered' : 'active',
                    )
                  "
                >
                  <CheckCircle2 :size="16" />
                  {{ item.status === 'active' ? '标记已掌握' : '重新加入复习' }}
                </button>
              </div>
            </article>
          </div>
          <section v-else class="empty-state compact-empty">
            <CheckCircle2 :size="30" />
            <h2>暂无单词错题</h2>
            <p>孩子答错的单词会自动进入这里。</p>
          </section>
        </section>
      </template>

      <template v-else-if="parentMode === 'models'">
        <p v-if="modelError" class="form-error content-notice" role="alert">
          {{ modelError }}
        </p>
        <p v-if="modelMessage" class="success-message content-notice" role="status">
          {{ modelMessage }}
        </p>

        <section class="model-routing">
          <div class="section-heading">
            <div>
              <p class="eyebrow">按能力路由</p>
              <h2>为不同任务选择合适的模型</h2>
              <p>业务功能只声明所需能力，运行时自动使用主模型或回退模型。</p>
            </div>
          </div>

          <div class="model-capability-tabs" aria-label="模型能力">
            <button
              v-for="capability in (['chat', 'embedding', 'vision'] as const)"
              :key="capability"
              type="button"
              :class="{ active: selectedModelCapability === capability }"
              @click="
                selectedModelCapability = capability;
                modelMessage = '';
                modelError = ''
              "
            >
              <MessageSquare v-if="capability === 'chat'" :size="18" />
              <Database v-else-if="capability === 'embedding'" :size="18" />
              <Eye v-else :size="18" />
              <span>
                {{
                  capability === 'chat'
                    ? 'Chat'
                    : capability === 'embedding'
                      ? 'Embedding'
                      : 'Vision'
                }}
              </span>
              <small>
                {{
                  modelConfigs?.capabilities.find(
                    (item) => item.capability === capability,
                  )?.configured
                    ? '已启用'
                    : '未启用'
                }}
              </small>
            </button>
          </div>

          <div class="model-usage">
            <strong>适用需求</strong>
            <span
              v-for="item in modelConfigs?.usage[selectedModelCapability] ?? []"
              :key="item"
            >
              {{ item }}
            </span>
          </div>

          <form
            v-if="selectedModelConfig"
            class="model-form"
            @submit.prevent="persistModelConfig"
          >
            <label class="toggle-field">
              <input v-model="selectedModelDraft.enabled" type="checkbox" />
              <span>启用此能力</span>
            </label>

            <fieldset>
              <legend>主模型</legend>
              <label>
                <span>API 地址</span>
                <input
                  v-model="selectedModelDraft.primary.baseUrl"
                  type="url"
                  placeholder="https://gateway.example.com/v1/chat/completions"
                  required
                  @input="invalidateModelOptions('primary')"
                />
              </label>
              <div class="model-picker-field">
                <span>模型名称</span>
                <div class="model-picker-toolbar">
                  <div class="model-search">
                    <Search :size="16" />
                    <input
                      v-model="selectedPrimaryCatalog.query"
                      type="search"
                      placeholder="获取后输入关键字搜索"
                      :disabled="!selectedPrimaryCatalog.loaded"
                    />
                  </div>
                  <button
                    class="secondary-button model-fetch-button"
                    type="button"
                    :disabled="
                      !selectedModelDraft.primary.baseUrl ||
                      selectedPrimaryCatalog.loading
                    "
                    @click="loadModelOptions('primary')"
                  >
                    <RefreshCw
                      :size="16"
                      :class="{ spinning: selectedPrimaryCatalog.loading }"
                    />
                    {{
                      selectedPrimaryCatalog.loading
                        ? '获取中'
                        : selectedPrimaryCatalog.loaded
                          ? '刷新'
                          : '获取模型'
                    }}
                  </button>
                </div>
                <div
                  v-if="selectedPrimaryCatalog.loaded"
                  class="model-option-list"
                  role="listbox"
                  aria-label="主模型列表"
                >
                  <button
                    v-for="model in filteredModelOptions('primary')"
                    :key="model"
                    type="button"
                    role="option"
                    :aria-selected="selectedModelDraft.primary.model === model"
                    :class="{
                      selected: selectedModelDraft.primary.model === model,
                    }"
                    @click="selectModelOption('primary', model)"
                  >
                    <Check
                      v-if="selectedModelDraft.primary.model === model"
                      :size="14"
                    />
                    <span>{{ model }}</span>
                  </button>
                  <p v-if="!filteredModelOptions('primary').length">
                    没有匹配的模型
                  </p>
                </div>
              </div>
              <label class="model-api-key-field">
                <span>API Key</span>
                <input
                  v-model="selectedModelDraft.primary.apiKey"
                  type="password"
                  :placeholder="
                    selectedModelConfig.primary.hasApiKey
                      ? `已保存 ${selectedModelConfig.primary.apiKeyMasked}`
                      : '首次启用时必须填写'
                  "
                  autocomplete="new-password"
                  @input="invalidateModelOptions('primary')"
                />
              </label>
            </fieldset>

            <label class="toggle-field fallback-toggle">
              <input
                v-model="selectedModelDraft.fallbackEnabled"
                type="checkbox"
              />
              <span>主模型失败时使用回退模型</span>
            </label>

            <fieldset v-if="selectedModelDraft.fallbackEnabled">
              <legend>回退模型</legend>
              <label>
                <span>API 地址</span>
                <input
                  v-model="selectedModelDraft.fallback.baseUrl"
                  type="url"
                  required
                  @input="invalidateModelOptions('fallback')"
                />
              </label>
              <div class="model-picker-field">
                <span>模型名称</span>
                <div class="model-picker-toolbar">
                  <div class="model-search">
                    <Search :size="16" />
                    <input
                      v-model="selectedFallbackCatalog.query"
                      type="search"
                      placeholder="获取后输入关键字搜索"
                      :disabled="!selectedFallbackCatalog.loaded"
                    />
                  </div>
                  <button
                    class="secondary-button model-fetch-button"
                    type="button"
                    :disabled="
                      !selectedModelDraft.fallback.baseUrl ||
                      selectedFallbackCatalog.loading
                    "
                    @click="loadModelOptions('fallback')"
                  >
                    <RefreshCw
                      :size="16"
                      :class="{ spinning: selectedFallbackCatalog.loading }"
                    />
                    {{
                      selectedFallbackCatalog.loading
                        ? '获取中'
                        : selectedFallbackCatalog.loaded
                          ? '刷新'
                          : '获取模型'
                    }}
                  </button>
                </div>
                <div
                  v-if="selectedFallbackCatalog.loaded"
                  class="model-option-list"
                  role="listbox"
                  aria-label="回退模型列表"
                >
                  <button
                    v-for="model in filteredModelOptions('fallback')"
                    :key="model"
                    type="button"
                    role="option"
                    :aria-selected="
                      selectedModelDraft.fallback.model === model
                    "
                    :class="{
                      selected: selectedModelDraft.fallback.model === model,
                    }"
                    @click="selectModelOption('fallback', model)"
                  >
                    <Check
                      v-if="selectedModelDraft.fallback.model === model"
                      :size="14"
                    />
                    <span>{{ model }}</span>
                  </button>
                  <p v-if="!filteredModelOptions('fallback').length">
                    没有匹配的模型
                  </p>
                </div>
              </div>
              <label class="model-api-key-field">
                <span>API Key</span>
                <input
                  v-model="selectedModelDraft.fallback.apiKey"
                  type="password"
                  :placeholder="
                    selectedModelConfig.fallback?.hasApiKey
                      ? `已保存 ${selectedModelConfig.fallback.apiKeyMasked}`
                      : '启用回退时必须填写'
                  "
                  autocomplete="new-password"
                  @input="invalidateModelOptions('fallback')"
                />
              </label>
            </fieldset>

            <div class="model-policy">
              <label>
                <span>失败重试次数</span>
                <select v-model.number="selectedModelDraft.retryCount">
                  <option v-for="count in 6" :key="count - 1" :value="count - 1">
                    {{ count - 1 }} 次
                  </option>
                </select>
              </label>
              <label>
                <span>单次请求超时</span>
                <select v-model.number="selectedModelDraft.timeoutMs">
                  <option :value="30000">30 秒</option>
                  <option :value="60000">60 秒</option>
                  <option :value="90000">90 秒</option>
                  <option :value="120000">120 秒</option>
                  <option :value="180000">180 秒</option>
                </select>
              </label>
              <p>
                网络错误、限流和服务端错误会重试；主模型仍失败后自动切换回退模型。
              </p>
            </div>

            <div class="model-actions">
              <span>API Key 加密保存，页面只显示末四位。</span>
              <button
                class="primary-button compact no-margin"
                type="submit"
                :disabled="savingModelConfig"
              >
                <Check :size="17" />
                {{ savingModelConfig ? '正在保存' : '保存配置' }}
              </button>
            </div>
          </form>
        </section>
      </template>

      <template v-else>
        <section class="summary-band">
          <div>
            <span>独立完成</span>
            <strong>{{ mastery?.summary.mastered ?? 0 }}</strong>
            <small>个知识点</small>
          </div>
          <div>
            <span>依赖提示</span>
            <strong>{{ mastery?.summary.hintDependent ?? 0 }}</strong>
            <small>个知识点</small>
          </div>
          <div>
            <span>待复核</span>
            <strong>{{ mastery?.summary.needsReview ?? 0 }}</strong>
            <small>条证据</small>
          </div>
        </section>

        <p v-if="masteryError" class="form-error content-notice" role="alert">
          {{ masteryError }}
        </p>
        <p
          v-if="masteryMessage"
          class="success-message content-notice"
          role="status"
        >
          {{ masteryMessage }}
        </p>

        <section v-if="masteryLoading" class="empty-state compact-empty">
          <div class="loader" aria-label="正在加载学习证据" />
        </section>

        <section
          v-else-if="mastery?.projections.length"
          class="mastery-section"
        >
          <div class="section-heading">
            <div>
              <h2>掌握证据</h2>
              <p>按正确率、提示依赖、稳定性和作答速度计算，复核不会直接修改系统判断。</p>
            </div>
            <small>{{ mastery.modelVersion }}</small>
          </div>

          <div class="mastery-list">
            <article
              v-for="projection in mastery.projections"
              :key="projection.projectionId"
              class="mastery-row"
            >
              <div class="mastery-row-heading">
                <div>
                  <span>{{ projection.chapter }}</span>
                  <h3>{{ projection.knowledgePointName }}</h3>
                </div>
                <span
                  class="mastery-status"
                  :class="projection.status"
                >
                  {{ masteryStatusLabel(projection.status) }}
                </span>
              </div>

              <div class="mastery-metrics">
                <div>
                  <span>有效作答</span>
                  <strong>{{ projection.sampleCount }}</strong>
                </div>
                <div>
                  <span>独立正确</span>
                  <strong>{{ projection.independentCorrectCount }}</strong>
                </div>
                <div>
                  <span>平均提示</span>
                  <strong>
                    L{{ projection.calculationDetails.averageHintLevel.toFixed(1) }}
                  </strong>
                </div>
                <div>
                  <span>证据天数</span>
                  <strong>{{ projection.spacedDayCount }}</strong>
                </div>
                <div>
                  <span>稳定性</span>
                  <strong>
                    {{ Math.round(projection.calculationDetails.stability * 100) }}%
                  </strong>
                </div>
                <div>
                  <span>速度</span>
                  <strong>
                    {{ Math.round(projection.calculationDetails.speed * 100) }}%
                  </strong>
                </div>
              </div>

              <p class="mastery-evidence-hint">
                {{ masteryEvidenceHint(projection) }}
              </p>

              <div
                v-if="
                  projection.status !== 'insufficient' &&
                  (!projection.review || projection.needsReview)
                "
                class="mastery-review"
              >
                <label>
                  <span>复核备注（可选）</span>
                  <textarea
                    v-model="masteryReviewNotes[projection.kpId]"
                    rows="2"
                    maxlength="500"
                    placeholder="记录判断依据"
                  />
                </label>
                <div>
                  <button
                    type="button"
                    class="secondary-button compact"
                    :disabled="Boolean(reviewingKnowledgePointId)"
                    @click="reviewMastery(projection, 'unsure')"
                  >
                    暂不确定
                  </button>
                  <button
                    type="button"
                    class="secondary-button compact"
                    :disabled="Boolean(reviewingKnowledgePointId)"
                    @click="reviewMastery(projection, 'disagree')"
                  >
                    不同意
                  </button>
                  <button
                    type="button"
                    class="primary-button compact no-margin"
                    :disabled="Boolean(reviewingKnowledgePointId)"
                    @click="reviewMastery(projection, 'agree')"
                  >
                    <Check :size="16" />
                    {{
                      reviewingKnowledgePointId === projection.kpId
                        ? '提交中'
                        : '同意判断'
                    }}
                  </button>
                </div>
              </div>

              <div
                v-else-if="projection.review?.current"
                class="mastery-reviewed"
              >
                <CheckCircle2 :size="17" />
                <span>
                  已复核：{{ reviewDecisionLabel(projection.review.decision) }}
                </span>
                <small v-if="projection.review.note">
                  {{ projection.review.note }}
                </small>
              </div>
            </article>
          </div>
        </section>

        <section v-else class="empty-state">
          <ShieldCheck :size="30" />
          <h2>暂无学习证据</h2>
          <p>孩子提交答案后，系统会在这里逐步形成掌握判断。</p>
        </section>
      </template>
    </main>

    <main v-else-if="childMode === 'training'" class="training-layout">
      <template v-if="training && !trainingComplete && currentQuestion">
        <aside class="session-rail">
          <div>
            <p class="eyebrow">今日训练</p>
            <h1>{{ training.title }}</h1>
            <p class="session-meta">
              {{ training.questions.length }} 道题 · 预计
              {{ training.estimatedMinutes }} 分钟
            </p>
          </div>

          <div class="progress-block">
            <div class="progress-label">
              <span>进度</span>
              <strong>{{ questionIndex + 1 }}/{{ training.questions.length }}</strong>
            </div>
            <div class="progress-track">
              <span :style="{ width: `${progress}%` }" />
            </div>
          </div>

          <div class="time-block">
            <Clock3 :size="18" />
            <div>
              <span>本次用时</span>
              <strong>{{ elapsedLabel }}</strong>
            </div>
          </div>
        </aside>

        <section class="question-workspace">
          <div class="question-heading">
            <span class="question-number">第 {{ questionIndex + 1 }} 题</span>
            <span class="question-type">
              {{
                currentQuestion.questionType === 'subjective'
                  ? '综合解答'
                  : '单项选择'
              }}
              · 难度 {{ currentQuestion.difficulty }}
            </span>
          </div>
          <h2>{{ currentQuestion.stem }}</h2>

          <div
            v-if="currentQuestion.questionType === 'single_choice'"
            class="options"
            role="radiogroup"
            aria-label="选择答案"
          >
            <button
              v-for="option in currentQuestion.options"
              :key="option.key"
              class="option"
              :class="{
                selected: selectedAnswer === option.key,
                locked: feedback === 'correct',
              }"
              type="button"
              :aria-checked="selectedAnswer === option.key"
              role="radio"
              :disabled="feedback === 'correct'"
              @click="selectedAnswer = option.key"
            >
              <span class="option-key">{{ option.key }}</span>
              <span>{{ option.text }}</span>
              <Check v-if="selectedAnswer === option.key" :size="18" />
            </button>
          </div>
          <label v-else class="subjective-answer">
            <span>写出推理和解答过程</span>
            <textarea
              v-model="selectedAnswer"
              rows="9"
              maxlength="5000"
              :disabled="feedback === 'correct'"
              placeholder="在这里写出关键步骤、推理依据和结论"
            />
            <small>{{ selectedAnswer.length }}/5000</small>
          </label>

          <div
            v-if="hintLoading"
            class="hint-panel hint-loading"
            role="status"
            aria-live="polite"
          >
            <div class="hint-title">
              <RefreshCw class="spinning" :size="18" />
              <strong>正在生成提示</strong>
            </div>
            <p>正在结合这道题和你的选择整理提示...</p>
          </div>

          <div v-else-if="hint" class="hint-panel" aria-live="polite">
            <div class="hint-title">
              <Lightbulb :size="18" />
              <strong>L{{ hint.level }} 提示</strong>
            </div>
            <p>{{ hint.text }}</p>
          </div>

          <div v-if="feedback === 'wrong'" class="feedback wrong" role="status">
            <span>
              {{
                currentQuestion.questionType === 'subjective'
                  ? gradingFeedback || '这份解答还需要补充关键推理。'
                  : '这一步还需要再想想。'
              }}
            </span>
            <button
              type="button"
              :disabled="hintLoading"
              :aria-busy="hintLoading"
              @click="askForHint"
            >
              <RefreshCw v-if="hintLoading" class="spinning" :size="17" />
              <Lightbulb v-else :size="17" />
              {{ hintLoading ? '正在生成提示' : '给我一点提示' }}
            </button>
          </div>

          <div v-if="feedback === 'correct'" class="feedback correct" role="status">
            <CheckCircle2 :size="20" />
            <span>
              {{
                currentQuestion.questionType === 'subjective'
                  ? gradingFeedback || '关键结论和主要推理已达到要求。'
                  : '这一步判断正确。'
              }}
            </span>
          </div>

          <p v-if="actionError" class="form-error" role="alert">{{ actionError }}</p>

          <div class="question-actions">
            <button
              v-if="feedback === 'wrong'"
              class="secondary-button"
              type="button"
              @click="retryQuestion"
            >
              <RotateCcw :size="17" />
              重新选择
            </button>
            <button
              v-if="feedback !== 'correct'"
              class="primary-button compact"
              type="button"
              :disabled="
                !selectedAnswer.trim() ||
                loading ||
                pendingAnswerQuestionId === currentQuestion.id
              "
              @click="submitAnswer"
            >
              {{
                pendingAnswerQuestionId === currentQuestion.id
                  ? '等待联网判题'
                  : loading && !hintLoading
                  ? currentQuestion.questionType === 'subjective'
                    ? 'AI 正在评分'
                    : '正在检查'
                  : '提交这一步'
              }}
              <ArrowRight :size="18" />
            </button>
            <button
              v-else
              class="primary-button compact"
              type="button"
              @click="nextQuestion"
            >
              {{
                training.budget.stopAddingQuestions
                  ? '结束今天训练'
                  : '下一题'
              }}
              <ArrowRight :size="18" />
            </button>
          </div>
        </section>
      </template>

      <section v-else-if="trainingComplete" class="complete-state">
        <div class="complete-icon"><CheckCircle2 :size="34" /></div>
        <p class="eyebrow">今日训练完成</p>
        <h1>你完成了今天的思考</h1>
        <p>用时 {{ elapsedLabel }}，学习记录将在联网后自动同步。</p>
      </section>

      <section v-else-if="noTrainingAssigned" class="complete-state">
        <div class="complete-icon"><Clock3 :size="34" /></div>
        <p class="eyebrow">今日任务</p>
        <h1>暂时没有新的考察</h1>
        <p>家长发起或系统安排例行考察后，题目会出现在这里。</p>
      </section>

      <section v-else class="center-state">
        <div class="loader" aria-label="正在加载训练" />
      </section>
    </main>

    <main v-else-if="childMode === 'tasks'" class="child-task-center">
      <div class="child-wrong-heading">
        <div>
          <p class="eyebrow">我的任务</p>
          <h1>今天需要完成的事情</h1>
        </div>
        <span>
          建议 {{ taskSnapshot?.workload.recommendedMinutes ?? 0 }} 分钟
        </span>
      </div>

      <p v-if="planningError" class="form-error content-notice" role="alert">
        {{ planningError }}
      </p>
      <p
        v-if="planningMessage"
        class="success-message content-notice"
        role="status"
      >
        {{ planningMessage }}
      </p>

      <section v-if="planningLoading" class="empty-state">
        <div class="loader" aria-label="正在加载任务" />
      </section>
      <section
        v-else-if="taskSnapshot?.tasks.length"
        class="child-task-list"
      >
        <article
          v-for="task in taskSnapshot.tasks.filter(
            (item) => item.status !== 'cancelled',
          )"
          :key="task.id"
        >
          <div class="task-heading">
            <div>
              <span>{{ task.subject }} · {{ task.kind }}</span>
              <h2>{{ task.title }}</h2>
            </div>
            <span class="task-status" :class="task.status">
              {{
                task.status === 'pending'
                  ? '待完成'
                  : task.status === 'claimed_done'
                    ? '等待家长核验'
                    : '已完成'
              }}
            </span>
          </div>
          <p v-if="task.description">{{ task.description }}</p>
          <small>
            预计 {{ task.estimatedMinutes }} 分钟
            <template v-if="task.dueAt">
              · 截止 {{ new Date(task.dueAt).toLocaleString('zh-CN') }}
            </template>
          </small>
          <button
            v-if="task.status === 'pending'"
            class="primary-button compact no-margin"
            type="button"
            :disabled="savingPlanningItem"
            @click="updateTaskState(task, 'claimed_done')"
          >
            <Check :size="17" />
            我完成了
          </button>
          <div v-else-if="task.status === 'claimed_done'" class="awaiting-review">
            <Clock3 :size="17" />
            已提交，等待家长核验
          </div>
        </article>
      </section>
      <section v-else class="empty-state">
        <CheckCircle2 :size="34" />
        <h2>当前没有待办任务</h2>
        <p>新的预习、作业或复习任务会出现在这里。</p>
      </section>
    </main>

    <main v-else-if="childMode === 'wrongBook'" class="child-wrong-book">
      <div class="child-wrong-heading">
        <div>
          <p class="eyebrow">错题复习</p>
          <h1>把易错点再想一遍</h1>
        </div>
        <span>{{ wrongBook?.items.length ?? 0 }} 道待复习</span>
      </div>

      <p v-if="wrongBookError" class="form-error content-notice" role="alert">
        {{ wrongBookError }}
      </p>
      <p
        v-if="wrongBookMessage"
        class="success-message content-notice"
        role="status"
      >
        {{ wrongBookMessage }}
      </p>

      <section v-if="wrongBookLoading" class="empty-state">
        <div class="loader" aria-label="正在加载错题" />
      </section>
      <section
        v-else-if="wrongBook?.items.length"
        class="child-wrong-list"
      >
        <article v-for="item in wrongBook.items" :key="item.id">
          <img
            v-if="item.hasPhoto"
            class="wrong-photo"
            :src="item.photoUrl || `/api/v1/wrong-items/${item.id}/photo`"
            alt="错题原图"
          />
          <div class="wrong-item-badges">
            <span>{{ item.knowledgePointName ?? '知识点待确认' }}</span>
            <span>{{ item.wrongCount }} 次错误</span>
          </div>
          <h2>{{ item.stem }}</h2>
          <p v-if="item.studentAnswer">
            上次作答：{{ item.studentAnswer }}
          </p>
          <div v-if="item.tags.length" class="wrong-tags">
            <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
          </div>
          <div class="child-review-actions">
            <button
              class="secondary-button"
              type="button"
              :disabled="Boolean(savingWrongItemId)"
              @click="submitWrongItemReview(item, 'incorrect')"
            >
              <RotateCcw :size="17" />
              还需要复习
            </button>
            <button
              class="primary-button compact no-margin"
              type="button"
              :disabled="Boolean(savingWrongItemId)"
              @click="submitWrongItemReview(item, 'correct')"
            >
              <Check :size="17" />
              这次会了
            </button>
          </div>
        </article>
      </section>
      <section v-else class="empty-state">
        <CheckCircle2 :size="34" />
        <h2>当前没有待复习错题</h2>
        <p>完成训练后，答错的题会自动进入这里。</p>
      </section>
    </main>

    <main v-else class="child-word-quiz">
      <p v-if="wordbookError" class="form-error content-notice" role="alert">
        {{ wordbookError }}
      </p>

      <section v-if="wordQuizResults" class="word-result-panel">
        <p class="eyebrow">本轮完成</p>
        <h1>
          答对 {{ wordCorrectCount }} / {{ wordQuizResults.length }}
        </h1>
        <p>
          {{
            wordCorrectCount === wordQuizResults.length
              ? '全部答对，很棒！'
              : '答错的单词已进入你的单词错题本。'
          }}
        </p>
        <button
          class="primary-button compact"
          type="button"
          @click="
            wordQuizResults = null;
            activeWordQuiz = null;
            loadWordQuizzes();
          "
        >
          <RotateCcw :size="17" />
          返回单词考察
        </button>
      </section>

      <section v-else-if="activeWordQuiz && currentWordQuestion" class="word-quiz-panel">
        <div class="child-wrong-heading">
          <div>
            <p class="eyebrow">
              {{ activeWordQuiz.quiz.direction === 'en_to_zh' ? '英译中' : '中译英' }}
            </p>
            <h1>第 {{ wordAnswerIndex + 1 }} / {{ activeWordQuiz.questions.length }} 题</h1>
          </div>
          <span>已选 {{ wordAnsweredCount }} 题</span>
        </div>

        <div class="word-stem">
          <span>{{ currentWordQuestion.stem }}</span>
        </div>

        <div class="word-options">
          <button
            v-for="option in currentWordQuestion.options"
            :key="option.key"
            type="button"
            :class="{ selected: currentWordSelection === option.key }"
            :disabled="submittingWordQuiz || activeWordQuiz.progress.some((item) => item.questionId === currentWordQuestion?.id)"
            @click="selectWordOption(option.key)"
          >
            <span class="word-option-key">{{ option.key }}</span>
            <span>{{ option.text }}</span>
          </button>
        </div>

        <div class="word-quiz-actions">
          <button
            class="secondary-button"
            type="button"
            :disabled="wordAnswerIndex === 0"
            @click="stepWordQuiz(-1)"
          >
            上一题
          </button>
          <button
            v-if="wordAnswerIndex < activeWordQuiz.questions.length - 1"
            class="primary-button compact no-margin"
            type="button"
            @click="stepWordQuiz(1)"
          >
            下一题
          </button>
          <button
            v-else
            class="primary-button compact no-margin"
            type="button"
            :disabled="submittingWordQuiz || wordAnsweredCount !== activeWordQuiz.questions.length"
            @click="handleSubmitWordQuiz"
          >
            <Check :size="17" />
            {{ submittingWordQuiz ? '提交中' : '提交本轮' }}
          </button>
        </div>
      </section>

      <template v-else>
        <div class="child-wrong-heading">
          <div>
            <p class="eyebrow">单词考察</p>
            <h1>今天要记的英语单词</h1>
          </div>
          <span>{{ wordQuizzes.length }} 轮</span>
        </div>

        <section
          v-if="wordStats"
          class="summary-band child-word-summary"
        >
          <div>
            <span>{{ wordStats.totalAnswers }}</span>
            <small>累计作答</small>
          </div>
          <div>
            <span>{{ wordAccuracyLabel }}</span>
            <small>正确率</small>
          </div>
          <div>
            <span>{{ wordStats.wrongItems.active }}</span>
            <small>待巩固单词</small>
          </div>
        </section>

        <section v-if="wordQuizzesLoading" class="empty-state">
          <div class="loader" aria-label="正在加载单词考察" />
        </section>
        <section v-else-if="wordQuizzes.length" class="child-task-list">
          <article
            v-for="quiz in wordQuizzes"
            :key="quiz.id"
            class="word-quiz-card"
          >
            <div class="task-heading">
              <div>
                <span>
                  {{ quiz.direction === 'en_to_zh' ? '英译中' : '中译英' }} ·
                  {{ quiz.questionCount }} 题
                </span>
                <h2>{{ quiz.assignedLocalDate }} 的单词考察</h2>
              </div>
              <span class="task-status">
                {{ quiz.status === 'completed' ? '已完成' : '待完成' }}
              </span>
            </div>
            <p v-if="quiz.deliveryMode === 'passport'">
              已下发到随身设备，也可以在网页端补做，答案会合并统计。
            </p>
            <button
              class="primary-button compact no-margin"
              type="button"
              :disabled="Boolean(openingWordQuizId)"
              @click="openWordQuiz(quiz)"
            >
              <Languages :size="17" />
              {{ openingWordQuizId === quiz.id ? '正在加载' : quiz.status === 'completed' ? '查看结果' : '开始或继续作答' }}
            </button>
          </article>
        </section>
        <section v-else class="empty-state">
          <Languages :size="34" />
          <h2>今天还没有单词考察</h2>
          <p>家长导入单词本并下发后，题目会出现在这里。</p>
        </section>
      </template>
    </main>
  </div>
</template>
