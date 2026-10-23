package com.kidstudy.child

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Url

interface KidStudyApi {
    @POST("v1/auth/login")
    suspend fun login(@Body request: LoginRequest): UserEnvelope

    @GET("v1/session")
    suspend fun session(): UserEnvelope

    @POST("v1/auth/logout")
    suspend fun logout(@Body body: Map<String, String> = emptyMap()): Response<Unit>

    @GET("v1/training/today")
    suspend fun todayTraining(): TodayTraining

    @POST("v1/training/attempts/start")
    suspend fun startAttempt(@Body request: StartAttemptRequest): StartAttemptResponse

    @POST("v1/answers/check")
    suspend fun checkAnswer(@Body request: AnswerRequest): AnswerResult

    @POST("v1/guide")
    suspend fun requestHint(@Body request: HintRequest): HintResult

    @GET("v1/wrong-items")
    suspend fun wrongItems(@Query("status") status: String = "active"): WrongBookSnapshot

    @GET("v1/tasks")
    suspend fun tasks(): TaskSnapshot

    @PATCH("v1/tasks/{id}/status")
    suspend fun changeTaskStatus(
        @Path("id") id: String,
        @Body request: TaskStatusRequest,
    ): TaskEnvelope

    @GET("v1/reports/weekly")
    suspend fun weeklyReport(): WeeklyReport

    @POST
    suspend fun reviewWrongItem(
        @Url path: String,
        @Body request: ReviewWrongItemRequest,
    ): Response<Unit>
}
