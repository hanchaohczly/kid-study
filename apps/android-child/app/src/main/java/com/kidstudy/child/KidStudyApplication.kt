package com.kidstudy.child

import android.app.Application
import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class KidStudyApplication : Application() {
    lateinit var repository: ChildRepository
        private set

    override fun onCreate() {
        super.onCreate()
        repository = ChildRepository(
            context = this,
            database = ChildDatabase.create(this),
            endpointStore = EndpointStore(this),
            childCookieJar = PersistentSessionCookieJar(this, "child_session_cookie"),
            parentCookieJar = PersistentSessionCookieJar(this, "parent_session_cookie"),
        )
    }
}

class AnswerSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result {
        val repository =
            (applicationContext as KidStudyApplication).repository
        return if (repository.syncPendingAnswers()) Result.success() else Result.retry()
    }
}
