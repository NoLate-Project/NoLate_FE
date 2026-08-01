package com.anonymous.nolate_fe

import org.junit.Assert.assertTrue
import org.junit.Test

class QuickScheduleOcrEvidenceTest {
    @Test
    fun scheduleShapedKoreanTextOutranksDecorativeText() {
        val schedule = quickScheduleOcrEvidenceScore(
            "8월 3일 오후 7시 강남역에서 미팅",
            0.86,
        )
        val decorative = quickScheduleOcrEvidenceScore("SUMMER SALE", 0.95)

        assertTrue(schedule > decorative)
        assertTrue(schedule >= 0.62)
    }

    @Test
    fun emptyRecognitionNeverLooksReliable() {
        assertTrue(quickScheduleOcrEvidenceScore("  ", 0.99) == 0.0)
    }
}
