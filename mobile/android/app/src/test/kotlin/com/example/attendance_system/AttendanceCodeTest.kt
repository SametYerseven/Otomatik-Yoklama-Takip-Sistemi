package com.example.attendance_system

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * docs/protocol.md bolum 11'deki test vektorleri. Bu anahtarlar sadece testtir.
 * Calistirma (mobile/android klasorunde): gradlew.bat :app:testDebugUnitTest
 */
class AttendanceCodeTest {

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    // Keystore bilgisayarda yok; StudentKeyStore.sign() ile ayni algoritma, anahtar elle verilir
    private fun hmac(key: ByteArray, message: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(message)
        }

    // 20 21 22 ... 3f
    private val testStudentKey = ByteArray(32) { (0x20 + it).toByte() }

    @Test
    fun messageLayoutMatchesProtocol() {
        // "STU" + 203 (00 cb) + 10803 (2a 33)
        assertEquals("53545500cb2a33", hex(AttendanceCode.studentMessage(203, 10803)))
    }

    @Test
    fun studentCodeMatchesTestVector() {
        assertEquals(
            "7d988e8182a6c3732551fbfad10d0fd8061463fc571e09eeb197e3c8586014f5",
            hex(hmac(testStudentKey, AttendanceCode.studentMessage(203, 10803)))
        )
    }

    @Test
    fun edgeValuesUseTwoBytesEach() {
        assertEquals("5354550000ffff", hex(AttendanceCode.studentMessage(0, 65535)))
    }

    @Test(expected = IllegalArgumentException::class)
    fun majorOutOfRangeIsRejected() {
        AttendanceCode.studentMessage(65536, 1)
    }

    @Test(expected = IllegalArgumentException::class)
    fun negativeClassCodeIsRejected() {
        AttendanceCode.studentMessage(203, -1)
    }
}
