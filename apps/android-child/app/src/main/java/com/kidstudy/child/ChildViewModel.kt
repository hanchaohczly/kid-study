package com.kidstudy.child

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class ChildScreen {
    HOME,
    TASKS,
    TRAINING,
    WRONG_BOOK,
    PARENT_LOGIN,
    PARENT,
}

data class ChildUiState(
    val checkingSession: Boolean = true,
    val loggedIn: Boolean = false,
    val endpoint: String = BuildConfig.DEFAULT_API_BASE_URL,
    val screen: ChildScreen = ChildScreen.HOME,
    val today: TodayTraining? = null,
    val tasks: TaskSnapshot? = null,
    val wrongBook: WrongBookSnapshot? = null,
    val parentTasks: TaskSnapshot? = null,
    val weeklyReport: WeeklyReport? = null,
    val parentSessionAvailable: Boolean = false,
    val questionIndex: Int = 0,
    val draft: AnswerDraft? = null,
    val completedQuestionIds: Set<String> = emptySet(),
    val queuedQuestionIds: Set<String> = emptySet(),
    val pendingCount: Int = 0,
    val usingCachedData: Boolean = false,
    val busyAction: String? = null,
    val notice: String? = null,
    val error: String? = null,
)

class ChildViewModel(
    private val repository: ChildRepository,
) : ViewModel() {
    var state = androidx.compose.runtime.mutableStateOf(
        ChildUiState(endpoint = repository.endpoint()),
    )
        private set

    private var draftSaveJob: Job? = null

    init {
        viewModelScope.launch {
            update {
                it.copy(parentSessionAvailable = repository.hasParentSession())
            }
            if (!repository.hasSession()) {
                update { it.copy(checkingSession = false) }
                return@launch
            }
            runCatching { repository.checkSession() }
                .onSuccess {
                    update { current ->
                        current.copy(checkingSession = false, loggedIn = true)
                    }
                    refresh()
                }
                .onFailure {
                    if (repository.hasOfflineWorkspace()) {
                        update { current ->
                            current.copy(
                                checkingSession = false,
                                loggedIn = true,
                                notice = "网络不可用，已恢复本机训练",
                            )
                        }
                        refresh()
                    } else {
                        update { current -> current.copy(checkingSession = false) }
                    }
                }
        }
    }

    fun login(endpoint: String, pin: String) {
        if (pin.isBlank() || state.value.busyAction != null) return
        launchAction("login") {
            repository.login(endpoint, pin)
            update {
                it.copy(
                    loggedIn = true,
                    endpoint = repository.endpoint(),
                    notice = null,
                )
            }
            loadDashboard()
        }
    }

    fun logout() {
        if (state.value.busyAction != null) return
        launchAction("logout") {
            repository.logout()
            state.value = ChildUiState(
                checkingSession = false,
                endpoint = repository.endpoint(),
            )
        }
    }

    fun refresh() {
        if (!state.value.loggedIn || state.value.busyAction != null) return
        launchAction("refresh") {
            loadDashboard()
        }
    }

    fun showHome() = update { it.copy(screen = ChildScreen.HOME, notice = null) }

    fun showTasks() =
        update { it.copy(screen = ChildScreen.TASKS, notice = null) }

    fun showWrongBook() =
        update { it.copy(screen = ChildScreen.WRONG_BOOK, notice = null) }

    fun showParentGate() =
        update {
            it.copy(
                screen = ChildScreen.PARENT_LOGIN,
                parentSessionAvailable = repository.hasParentSession(),
                notice = null,
            )
        }

    fun loginParent(password: String) {
        if (password.isBlank() || state.value.busyAction != null) return
        launchAction("parent-login") {
            repository.loginParent(password)
            loadParentDashboard()
        }
    }

    fun unlockParentSession() {
        if (state.value.busyAction != null) return
        launchAction("parent-unlock") {
            repository.resumeParentSession()
            loadParentDashboard()
        }
    }

    fun exitParent() {
        update {
            it.copy(
                screen = ChildScreen.HOME,
                parentTasks = null,
                weeklyReport = null,
                notice = null,
            )
        }
    }

    fun openTraining() {
        val snapshot = state.value
        val today = snapshot.today ?: return
        if (today.questions.isEmpty()) {
            update { it.copy(screen = ChildScreen.TRAINING) }
            return
        }
        update {
            it.copy(
                screen = ChildScreen.TRAINING,
                draft = null,
                notice = null,
            )
        }
        val active = today.activeAttempt ?: return
        val activeIndex = today.questions.indexOfFirst { it.id == active.questionId }
        if (activeIndex >= 0) openQuestion(activeIndex)
    }

    fun openQuestion(index: Int) {
        val snapshot = state.value
        val today = snapshot.today ?: return
        val question = today.questions.getOrNull(index) ?: return
        if (snapshot.busyAction != null) return
        launchAction("start") {
            val draft = repository.beginQuestion(question.id, today.activeAttempt)
            update {
                it.copy(
                    screen = ChildScreen.TRAINING,
                    questionIndex = index,
                    draft = draft,
                    notice = null,
                    today = it.today?.copy(
                        activeAttempt = ActiveAttempt(
                            attemptId = draft.attemptId,
                            questionId = question.id,
                            hintLevel = draft.hintLevel,
                        ),
                    ),
                )
            }
        }
    }

    fun changeAnswer(answer: String, selectedOption: String? = null) {
        val draft = state.value.draft ?: return
        val next = draft.copy(
            answer = answer,
            selectedOption = selectedOption,
            updatedAtEpochMs = System.currentTimeMillis(),
        )
        update { it.copy(draft = next, notice = null) }
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(250)
            repository.saveDraft(next)
        }
    }

    fun changeHandwriting(handwritingJson: String) {
        val draft = state.value.draft ?: return
        val next = draft.copy(
            handwritingJson = handwritingJson,
            updatedAtEpochMs = System.currentTimeMillis(),
        )
        update { it.copy(draft = next, notice = null) }
        draftSaveJob?.cancel()
        draftSaveJob = viewModelScope.launch {
            delay(250)
            repository.saveDraft(next)
        }
    }

    fun submitAnswer() {
        val snapshot = state.value
        val draft = snapshot.draft ?: return
        val today = snapshot.today ?: return
        if (
            draft.answer.isBlank() ||
            snapshot.busyAction != null ||
            draft.questionId in snapshot.queuedQuestionIds
        ) return
        launchAction("submit") {
            repository.saveDraft(draft)
            when (val outcome = repository.submitAnswer(today.localDate, draft)) {
                is SubmitOutcome.Queued -> {
                    update {
                        it.copy(
                            queuedQuestionIds = it.queuedQuestionIds + draft.questionId,
                            pendingCount = it.pendingCount + 1,
                            notice = "网络暂不可用，答案已保存并将在联网后提交",
                        )
                    }
                }

                is SubmitOutcome.Judged -> {
                    val result = outcome.result
                    if (result.correct) {
                        val completed = snapshot.completedQuestionIds + draft.questionId
                        val nextIndex = firstIncomplete(today, completed)
                        update {
                            it.copy(
                                completedQuestionIds = completed,
                                questionIndex = nextIndex,
                                draft = null,
                                today = it.today?.copy(
                                    activeAttempt = null,
                                    budget = result.budget,
                                ),
                                notice = result.feedback?.takeIf(String::isNotBlank)
                                    ?: "回答正确，已记录本题",
                            )
                        }
                    } else {
                        update {
                            it.copy(
                                today = it.today?.copy(budget = result.budget),
                                notice = result.feedback?.takeIf(String::isNotBlank)
                                    ?: "这一步还不对，可以修改后再试",
                            )
                        }
                    }
                }
            }
        }
    }

    fun requestHint() {
        val draft = state.value.draft ?: return
        if (state.value.busyAction != null || draft.hintLevel >= 3) return
        launchAction("hint") {
            val next = repository.requestHint(draft)
            update {
                it.copy(
                    draft = next,
                    today = it.today?.copy(
                        activeAttempt = it.today.activeAttempt?.copy(
                            hintLevel = next.hintLevel,
                        ),
                    ),
                    notice = null,
                )
            }
        }
    }

    fun reviewWrongItem(id: String, correct: Boolean) {
        if (state.value.busyAction != null) return
        launchAction("review:$id") {
            repository.reviewWrongItem(id, correct)
            val refreshed = repository.loadWrongItems()
            update {
                it.copy(
                    wrongBook = refreshed.value,
                    usingCachedData = refreshed.fromCache,
                    notice = if (correct) {
                        "已记录为独立完成；连续两次后会自动标记掌握"
                    } else {
                        "已加入后续复习"
                    },
                )
            }
        }
    }

    fun claimTaskDone(id: String) {
        if (state.value.busyAction != null) return
        launchAction("task:$id") {
            val tasks = repository.changeChildTaskStatus(id, "claimed_done")
            update {
                it.copy(
                    tasks = tasks,
                    notice = "已提交完成确认，等待家长核验",
                )
            }
        }
    }

    fun verifyTask(id: String) {
        if (state.value.busyAction != null) return
        launchAction("parent-task:$id") {
            val tasks = repository.changeParentTaskStatus(id, "verified")
            update {
                it.copy(
                    parentTasks = tasks,
                    notice = "任务已核验完成",
                )
            }
        }
    }

    fun handleDeepLink(uri: Uri?) {
        if (uri == null || !state.value.loggedIn) return
        when (uri.pathSegments.lastOrNull()) {
            "training" -> openTraining()
            "tasks" -> showTasks()
            "wrong-book" -> showWrongBook()
        }
    }

    fun clearMessage() = update { it.copy(error = null, notice = null) }

    private fun firstIncomplete(
        today: TodayTraining,
        completed: Set<String>,
    ): Int {
        val index = today.questions.indexOfFirst { it.id !in completed }
        return if (index >= 0) index else today.questions.lastIndex.coerceAtLeast(0)
    }

    private suspend fun loadDashboard() {
        if (repository.pendingCount() > 0) {
            repository.syncPendingAnswers()
        }
        val todayTask = viewModelScope.async { repository.loadToday() }
        val wrongTask = viewModelScope.async {
            runCatching { repository.loadWrongItems() }.getOrNull()
        }
        val tasksTask = viewModelScope.async {
            runCatching { repository.loadTasks() }.getOrNull()
        }
        val today = todayTask.await()
        val wrong = wrongTask.await()
        val tasks = tasksTask.await()
        val completed = repository.completedQuestionIds(today.value.localDate)
        val activeIndex = today.value.activeAttempt?.let { active ->
            today.value.questions.indexOfFirst { it.id == active.questionId }
                .takeIf { it >= 0 }
        }
        val pendingIds = repository.pendingQuestionIds()
        val pendingCount = repository.pendingCount()
        update {
            it.copy(
                today = today.value,
                wrongBook = wrong?.value ?: it.wrongBook,
                tasks = tasks?.value ?: it.tasks,
                questionIndex = activeIndex ?: firstIncomplete(today.value, completed),
                completedQuestionIds = completed,
                queuedQuestionIds = pendingIds,
                pendingCount = pendingCount,
                usingCachedData =
                    today.fromCache ||
                        wrong?.fromCache == true ||
                        tasks?.fromCache == true,
            )
        }
    }

    private suspend fun loadParentDashboard() {
        val tasks = viewModelScope.async { repository.loadParentTasks() }
        val report = viewModelScope.async { repository.loadParentWeeklyReport() }
        val parentTasks = tasks.await()
        val weeklyReport = report.await()
        update {
            it.copy(
                screen = ChildScreen.PARENT,
                parentTasks = parentTasks,
                weeklyReport = weeklyReport,
                parentSessionAvailable = true,
                notice = null,
            )
        }
    }

    private fun launchAction(name: String, block: suspend () -> Unit) {
        viewModelScope.launch {
            update { it.copy(busyAction = name, error = null) }
            try {
                block()
            } catch (error: Throwable) {
                update {
                    it.copy(
                        error = error.message ?: "操作失败，请稍后重试",
                    )
                }
            } finally {
                update { it.copy(busyAction = null) }
            }
        }
    }

    private fun update(transform: (ChildUiState) -> ChildUiState) {
        state.value = transform(state.value)
    }

    companion object {
        fun factory(repository: ChildRepository): ViewModelProvider.Factory =
            object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    ChildViewModel(repository) as T
            }
    }
}
