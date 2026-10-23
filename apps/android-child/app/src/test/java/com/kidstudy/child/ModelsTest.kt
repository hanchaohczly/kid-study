package com.kidstudy.child

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ModelsTest {
    @Test
    fun `normalizes emulator and lan endpoints`() {
        assertEquals(
            "http://10.0.2.2:8080/api/",
            normalizeBaseUrl("10.0.2.2:8080"),
        )
        assertEquals(
            "http://192.168.1.20:8080/api/",
            normalizeBaseUrl("http://192.168.1.20:8080/api/"),
        )
    }

    @Test
    fun `child wrong item model does not retain private answer fields`() {
        val json = """
            {
              "id": "item-1",
              "source": "system",
              "stem": "2 + 2 = ?",
              "studentAnswer": "5",
              "answerKey": "4",
              "analysis": "private explanation",
              "hasPhoto": false,
              "mappingMethod": "question",
              "mappingConfirmed": true,
              "status": "active",
              "tags": [],
              "note": "",
              "wrongCount": 1,
              "reviewCount": 0,
              "correctReviewStreak": 0,
              "firstWrongAt": "2026-10-13T00:00:00Z",
              "latestWrongAt": "2026-10-13T00:00:00Z"
            }
        """.trimIndent()

        val item = Gson().fromJson(json, WrongItem::class.java)
        val serialized = Gson().toJson(item)

        assertEquals("2 + 2 = ?", item.stem)
        assertFalse(serialized.contains("answerKey"))
        assertFalse(serialized.contains("analysis"))
        assertFalse(serialized.contains("private explanation"))
    }
}
