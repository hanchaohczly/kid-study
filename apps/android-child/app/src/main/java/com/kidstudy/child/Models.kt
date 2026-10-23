package com.kidstudy.child

data class LoginRequest(val role: String = "child", val credential: String)
data class UserEnvelope(val user: SessionUser)
data class SessionUser(val id: String, val role: String, val kidId: String?)

data class TrainingOption(val key: String, val text: String)

data class TrainingQuestion(
    val id: String,
    val kpId: String,
    val stem: String,
    val options: List<TrainingOption> = emptyList(),
    val questionType: String,
    val difficulty: Int,
)

data class TrainingBudget(
    val serverStartedAt: String?,
    val elapsedSeconds: Int,
    val remainingSeconds: Int,
    val stopAddingQuestions: Boolean,
    val sessionClosed: Boolean,
)

data class ActiveAttempt(
    val attemptId: String,
    val questionId: String,
    val hintLevel: Int,
)

data class TodayTraining(
    val planId: String,
    val sessionId: String?,
    val localDate: String,
    val title: String,
    val estimatedMinutes: Int,
    val stopAddingAtMinutes: Int,
    val closeAtMinutes: Int,
    val budget: TrainingBudget,
    val activeAttempt: ActiveAttempt?,
    val questions: List<TrainingQuestion> = emptyList(),
)

data class StartAttemptRequest(val attemptId: String, val questionId: String)
data class StartAttemptResponse(val attemptId: String, val budget: TrainingBudget)

data class AnswerRequest(
    val submissionId: String,
    val attemptId: String,
    val questionId: String,
    val answer: String,
)

data class AnswerResult(
    val correct: Boolean,
    val nextAction: String,
    val score: Int?,
    val feedback: String?,
    val budget: TrainingBudget,
)

data class HintRequest(
    val attemptId: String,
    val questionId: String,
    val selectedAnswer: String,
    val kidInput: String,
)

data class HintResult(
    val attemptId: String,
    val guideAttemptId: String,
    val text: String,
    val hintLevel: Int,
    val safetyResult: String,
    val policyVersion: String,
)

data class WrongBookSnapshot(
    val photoRecognitionConfigured: Boolean,
    val items: List<WrongItem> = emptyList(),
)

// Intentionally excludes answerKey and analysis. Those fields must never enter the child app.
data class WrongItem(
    val id: String,
    val source: String,
    val questionId: String?,
    val kpId: String?,
    val knowledgePointName: String?,
    val chapter: String?,
    val stem: String,
    val studentAnswer: String?,
    val hasPhoto: Boolean,
    val photoUrl: String?,
    val mappingConfidence: Double?,
    val mappingMethod: String,
    val mappingConfirmed: Boolean,
    val status: String,
    val tags: List<String> = emptyList(),
    val note: String,
    val wrongCount: Int,
    val reviewCount: Int,
    val correctReviewStreak: Int,
    val firstWrongAt: String,
    val latestWrongAt: String,
    val nextReviewAt: String?,
)

data class ReviewWrongItemRequest(val result: String)

data class LearningTask(
    val id: String,
    val source: String,
    val kind: String,
    val title: String,
    val description: String,
    val subject: String,
    val kpId: String?,
    val dueAt: String?,
    val estimatedMinutes: Int,
    val priority: Int,
    val status: String,
    val claimedDoneAt: String?,
    val verifiedAt: String?,
)

data class TaskWorkload(
    val plannedMinutes: Int,
    val overdueCount: Int,
    val recommendedMinutes: Int,
    val reduced: Boolean,
)

data class TaskSnapshot(
    val tasks: List<LearningTask> = emptyList(),
    val workload: TaskWorkload,
)

data class TaskStatusRequest(val status: String)
data class TaskEnvelope(val task: LearningTask)

data class WeeklyReportPeriod(val from: String, val to: String)

data class WeeklyReportOverview(
    val attempts: Int,
    val independentAttempts: Int,
    val accuracy: Double?,
    val mastered: Int,
    val needsReview: Int,
)

data class WeeklyReportTrend(
    val previousAccuracy: Double?,
    val change: Double?,
    val direction: String,
)

data class WeeklyReportFocus(
    val kpId: String,
    val name: String,
    val status: String,
    val score: Double?,
    val hintDependence: Double,
)

data class WeeklyReport(
    val generatedAt: String,
    val period: WeeklyReportPeriod,
    val overview: WeeklyReportOverview,
    val trend: WeeklyReportTrend,
    val focus: List<WeeklyReportFocus> = emptyList(),
    val suggestions: List<String> = emptyList(),
)

data class StrokePoint(val x: Float, val y: Float)

data class ApiError(val code: String?, val message: String?, val retryable: Boolean?)

fun normalizeBaseUrl(value: String): String {
    val trimmed = value.trim().removeSuffix("/")
    if (trimmed.isBlank()) return BuildConfig.DEFAULT_API_BASE_URL
    val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
    return if (withScheme.endsWith("/api")) "$withScheme/" else "$withScheme/api/"
}
