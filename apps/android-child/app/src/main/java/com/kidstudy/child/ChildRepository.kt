package com.kidstudy.child

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.google.gson.Gson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException
import java.util.UUID

data class Loaded<T>(val value: T, val fromCache: Boolean)

sealed interface SubmitOutcome {
    data class Judged(val result: AnswerResult) : SubmitOutcome
    data object Queued : SubmitOutcome
}

class AppException(message: String, val retryable: Boolean = false) : Exception(message)

class ChildRepository(
    private val context: Context,
    private val database: ChildDatabase,
    private val endpointStore: EndpointStore,
    private val childCookieJar: PersistentSessionCookieJar,
    private val parentCookieJar: PersistentSessionCookieJar,
) {
    private val gson = Gson()
    private val childApiFactory = ApiFactory(childCookieJar)
    private val parentApiFactory = ApiFactory(parentCookieJar)
    private val dao = database.childDao()

    fun endpoint(): String = endpointStore.get()
    fun hasSession(): Boolean = childCookieJar.hasSession()
    fun hasParentSession(): Boolean = parentCookieJar.hasSession()

    suspend fun login(endpoint: String, pin: String): SessionUser = call {
        childCookieJar.clear()
        endpointStore.set(endpoint)
        childApi().login(LoginRequest(credential = pin)).user.also { user ->
            if (user.role != "child") throw AppException("该账号不是孩子账号")
        }
    }

    suspend fun checkSession(): SessionUser = call {
        childApi().session().user
    }

    suspend fun hasOfflineWorkspace(): Boolean =
        childCookieJar.hasSession() && dao.hasCache(TODAY_CACHE)

    suspend fun loginParent(password: String): SessionUser = call {
        parentCookieJar.clear()
        parentApi().login(LoginRequest(role = "parent", credential = password)).user.also { user ->
            if (user.role != "parent") throw AppException("该账号不是家长账号")
        }
    }

    suspend fun resumeParentSession(): SessionUser = call {
        if (!parentCookieJar.hasSession()) throw AppException("没有可用的家长会话")
        parentApi().session().user.also { user ->
            if (user.role != "parent") throw AppException("家长会话已失效")
        }
    }

    suspend fun logout() {
        runCatching { childApi().logout() }
        childCookieJar.clear()
        withContext(Dispatchers.IO) {
            dao.clearCaches()
            dao.clearDrafts()
            dao.clearPendingAnswers()
        }
    }

    suspend fun loadToday(): Loaded<TodayTraining> =
        loadCached(TODAY_CACHE, TodayTraining::class.java) {
            childApi().todayTraining()
        }

    suspend fun loadWrongItems(): Loaded<WrongBookSnapshot> =
        loadCached(WRONG_CACHE, WrongBookSnapshot::class.java) {
            childApi().wrongItems()
        }

    suspend fun loadTasks(): Loaded<TaskSnapshot> =
        loadCached(TASKS_CACHE, TaskSnapshot::class.java) {
            childApi().tasks()
        }

    suspend fun beginQuestion(
        questionId: String,
        activeAttempt: ActiveAttempt?,
    ): AnswerDraft {
        val existing = dao.getDraft(questionId)
        if (activeAttempt?.questionId == questionId) {
            existing?.takeIf { it.attemptId == activeAttempt.attemptId }?.let {
                return it
            }
            val resumed = AnswerDraft(
                questionId = questionId,
                attemptId = activeAttempt.attemptId,
                answer = "",
                selectedOption = null,
                hintText = null,
                hintLevel = activeAttempt.hintLevel,
                handwritingJson = "[]",
                updatedAtEpochMs = System.currentTimeMillis(),
            )
            dao.putDraft(resumed)
            return resumed
        }
        if (activeAttempt != null) {
            throw AppException("请先完成正在作答的题目")
        }

        val attemptId = existing?.attemptId ?: UUID.randomUUID().toString()
        try {
            call {
                childApi().startAttempt(StartAttemptRequest(attemptId, questionId))
            }
        } catch (error: AppException) {
            if (!error.retryable) throw error
        } catch (_: IOException) {
            // The attempt is created with the same id before the queued answer is replayed.
        }
        if (existing != null) return existing
        val created = AnswerDraft(
            questionId = questionId,
            attemptId = attemptId,
            answer = "",
            selectedOption = null,
            hintText = null,
            hintLevel = 0,
            handwritingJson = "[]",
            updatedAtEpochMs = System.currentTimeMillis(),
        )
        dao.putDraft(created)
        return created
    }

    suspend fun saveDraft(draft: AnswerDraft) {
        dao.putDraft(draft.copy(updatedAtEpochMs = System.currentTimeMillis()))
    }

    suspend fun submitAnswer(
        localDate: String,
        draft: AnswerDraft,
    ): SubmitOutcome {
        if (dao.pendingAnswerCount() >= MAX_PENDING_ANSWERS) {
            throw AppException("离线答案已达上限，请联网同步后继续")
        }
        val pending = PendingAnswer(
            submissionId = UUID.randomUUID().toString(),
            attemptId = draft.attemptId,
            questionId = draft.questionId,
            answer = draft.answer.trim(),
            createdAtEpochMs = System.currentTimeMillis(),
        )
        dao.enqueueAnswer(pending)
        return try {
            val result = call {
                childApi().checkAnswer(pending.toRequest())
            }
            finishPending(localDate, pending, result)
            SubmitOutcome.Judged(result)
        } catch (error: AppException) {
            if (error.retryable) {
                scheduleSync()
                SubmitOutcome.Queued
            } else {
                dao.deletePendingAnswer(pending.submissionId)
                throw error
            }
        } catch (_: IOException) {
            scheduleSync()
            SubmitOutcome.Queued
        }
    }

    suspend fun requestHint(draft: AnswerDraft): AnswerDraft {
        val result = call {
            childApi().requestHint(
                HintRequest(
                    attemptId = draft.attemptId,
                    questionId = draft.questionId,
                    selectedAnswer = draft.selectedOption ?: "A",
                    kidInput = draft.answer,
                ),
            )
        }
        return draft.copy(
            hintText = result.text,
            hintLevel = result.hintLevel,
            updatedAtEpochMs = System.currentTimeMillis(),
        ).also { dao.putDraft(it) }
    }

    suspend fun reviewWrongItem(id: String, correct: Boolean) = call {
        val response = childApi().reviewWrongItem(
            "v1/wrong-items/$id/reviews",
            ReviewWrongItemRequest(if (correct) "correct" else "incorrect"),
        )
        if (!response.isSuccessful) {
            throw HttpException(response)
        }
    }

    suspend fun completedQuestionIds(localDate: String): Set<String> {
        dao.pruneCompletedQuestions(localDate)
        return dao.completedQuestionIds(localDate).toSet()
    }

    suspend fun pendingCount(): Int = dao.pendingAnswerCount()

    suspend fun pendingQuestionIds(): Set<String> =
        dao.pendingQuestionIds().toSet()

    suspend fun changeChildTaskStatus(id: String, status: String): TaskSnapshot = call {
        childApi().changeTaskStatus(id, TaskStatusRequest(status))
        childApi().tasks().also {
            dao.putCache(
                CachedPayload(TASKS_CACHE, gson.toJson(it), System.currentTimeMillis()),
            )
        }
    }

    suspend fun loadParentTasks(): TaskSnapshot = call { parentApi().tasks() }

    suspend fun loadParentWeeklyReport(): WeeklyReport = call {
        parentApi().weeklyReport()
    }

    suspend fun changeParentTaskStatus(id: String, status: String): TaskSnapshot = call {
        parentApi().changeTaskStatus(id, TaskStatusRequest(status))
        parentApi().tasks()
    }

    suspend fun syncPendingAnswers(): Boolean {
        for (pending in dao.pendingAnswers()) {
            try {
                val training = childApi().todayTraining()
                childApi().startAttempt(
                    StartAttemptRequest(pending.attemptId, pending.questionId),
                )
                val result = childApi().checkAnswer(pending.toRequest())
                finishPending(training.localDate, pending, result)
            } catch (_: IOException) {
                return false
            } catch (error: HttpException) {
                if (error.code() == 401 || error.code() >= 500) return false
                return false
            }
        }
        return true
    }

    private suspend fun finishPending(
        localDate: String,
        pending: PendingAnswer,
        result: AnswerResult,
    ) {
        dao.deletePendingAnswer(pending.submissionId)
        if (result.correct) {
            dao.completeQuestion(
                CompletedQuestion(
                    localDate = localDate,
                    questionId = pending.questionId,
                    completedAtEpochMs = System.currentTimeMillis(),
                ),
            )
            dao.deleteDraft(pending.questionId)
        }
    }

    private fun PendingAnswer.toRequest() = AnswerRequest(
        submissionId = submissionId,
        attemptId = attemptId,
        questionId = questionId,
        answer = answer,
    )

    private suspend fun <T> loadCached(
        key: String,
        type: Class<T>,
        loader: suspend () -> T,
    ): Loaded<T> {
        return try {
            val value = call(loader)
            dao.putCache(CachedPayload(key, gson.toJson(value), System.currentTimeMillis()))
            Loaded(value, false)
        } catch (networkError: IOException) {
            val cached = dao.getCache(key) ?: throw networkError
            Loaded(gson.fromJson(cached.json, type), true)
        }
    }

    private fun childApi(): KidStudyApi =
        childApiFactory.create(endpointStore.get())

    private fun parentApi(): KidStudyApi =
        parentApiFactory.create(endpointStore.get())

    private fun scheduleSync() {
        val request = OneTimeWorkRequestBuilder<AnswerSyncWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(
            SYNC_WORK_NAME,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    private suspend fun <T> call(block: suspend () -> T): T {
        try {
            return block()
        } catch (error: HttpException) {
            val parsed = runCatching {
                gson.fromJson(error.response()?.errorBody()?.string(), ApiError::class.java)
            }.getOrNull()
            throw AppException(
                parsed?.message ?: "请求失败（${error.code()}）",
                parsed?.retryable == true || error.code() >= 500,
            )
        }
    }

    private companion object {
        const val TODAY_CACHE = "today_training"
        const val WRONG_CACHE = "wrong_items"
        const val TASKS_CACHE = "learning_tasks"
        const val SYNC_WORK_NAME = "answer-sync"
        const val MAX_PENDING_ANSWERS = 100
    }
}
