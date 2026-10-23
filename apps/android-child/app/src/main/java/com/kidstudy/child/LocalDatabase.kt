package com.kidstudy.child

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "cached_payloads")
data class CachedPayload(
    @PrimaryKey val key: String,
    val json: String,
    val updatedAtEpochMs: Long,
)

@Entity(tableName = "answer_drafts")
data class AnswerDraft(
    @PrimaryKey val questionId: String,
    val attemptId: String,
    val answer: String,
    val selectedOption: String?,
    val hintText: String?,
    val hintLevel: Int,
    val handwritingJson: String = "[]",
    val updatedAtEpochMs: Long,
)

@Entity(tableName = "pending_answers")
data class PendingAnswer(
    @PrimaryKey val submissionId: String,
    val attemptId: String,
    val questionId: String,
    val answer: String,
    val createdAtEpochMs: Long,
)

@Entity(
    tableName = "completed_questions",
    primaryKeys = ["localDate", "questionId"],
)
data class CompletedQuestion(
    val localDate: String,
    val questionId: String,
    val completedAtEpochMs: Long,
)

@Dao
interface ChildDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putCache(value: CachedPayload)

    @Query("SELECT * FROM cached_payloads WHERE `key` = :key")
    suspend fun getCache(key: String): CachedPayload?

    @Query("SELECT EXISTS(SELECT 1 FROM cached_payloads WHERE `key` = :key)")
    suspend fun hasCache(key: String): Boolean

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putDraft(value: AnswerDraft)

    @Query("SELECT * FROM answer_drafts WHERE questionId = :questionId")
    suspend fun getDraft(questionId: String): AnswerDraft?

    @Query("DELETE FROM answer_drafts WHERE questionId = :questionId")
    suspend fun deleteDraft(questionId: String)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun enqueueAnswer(value: PendingAnswer)

    @Query("SELECT * FROM pending_answers ORDER BY createdAtEpochMs")
    suspend fun pendingAnswers(): List<PendingAnswer>

    @Query("SELECT COUNT(*) FROM pending_answers")
    suspend fun pendingAnswerCount(): Int

    @Query("SELECT DISTINCT questionId FROM pending_answers")
    suspend fun pendingQuestionIds(): List<String>

    @Query("DELETE FROM pending_answers WHERE submissionId = :submissionId")
    suspend fun deletePendingAnswer(submissionId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun completeQuestion(value: CompletedQuestion)

    @Query("SELECT questionId FROM completed_questions WHERE localDate = :localDate")
    suspend fun completedQuestionIds(localDate: String): List<String>

    @Query("DELETE FROM completed_questions WHERE localDate != :localDate")
    suspend fun pruneCompletedQuestions(localDate: String)

    @Query("DELETE FROM cached_payloads")
    suspend fun clearCaches()

    @Query("DELETE FROM answer_drafts")
    suspend fun clearDrafts()

    @Query("DELETE FROM pending_answers")
    suspend fun clearPendingAnswers()
}

@Database(
    entities = [
        CachedPayload::class,
        AnswerDraft::class,
        PendingAnswer::class,
        CompletedQuestion::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class ChildDatabase : RoomDatabase() {
    abstract fun childDao(): ChildDao

    companion object {
        fun create(context: Context): ChildDatabase =
            Room.databaseBuilder(
                context.applicationContext,
                ChildDatabase::class.java,
                "kid-study-child.db",
            )
                .addMigrations(MIGRATION_1_2)
                .build()

        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "ALTER TABLE answer_drafts " +
                        "ADD COLUMN handwritingJson TEXT NOT NULL DEFAULT '[]'",
                )
            }
        }
    }
}
