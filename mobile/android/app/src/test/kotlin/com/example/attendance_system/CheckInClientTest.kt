package com.example.attendance_system

import com.example.attendance_system.CheckInClient.Result
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Sunucu yanitlarinin dogru yorumlandigini kontrol eder (ag yok, sadece yorumlama). */
class CheckInClientTest {

    @Test
    fun successResponses() {
        assertEquals(Result.Ok, CheckInClient.parseResponse(mapOf("result" to "ok")))
        assertEquals(Result.Duplicate, CheckInClient.parseResponse(mapOf("result" to "duplicate")))
        assertEquals(Result.NoSession, CheckInClient.parseResponse(mapOf("result" to "no-session")))
    }

    @Test
    fun unknownResponseIsFailure() {
        assertTrue(CheckInClient.parseResponse(mapOf("result" to "???")) is Result.Failed)
        assertTrue(CheckInClient.parseResponse(null) is Result.Failed)
    }

    @Test
    fun noKeyIsRecognized() {
        assertEquals(Result.NoKey, CheckInClient.classifyError("FAILED_PRECONDITION", "no-key"))
    }

    @Test
    fun wrongCodesAreRejections() {
        assertTrue(CheckInClient.classifyError("PERMISSION_DENIED", "class-code") is Result.Rejected)
        assertTrue(CheckInClient.classifyError("PERMISSION_DENIED", "student-code") is Result.Rejected)
        assertTrue(CheckInClient.classifyError("UNAUTHENTICATED", null) is Result.Rejected)
    }

    @Test
    fun networkProblemsAreFailures() {
        assertTrue(CheckInClient.classifyError("UNAVAILABLE", "offline") is Result.Failed)
        assertTrue(CheckInClient.classifyError("DEADLINE_EXCEEDED", null) is Result.Failed)
    }
}
