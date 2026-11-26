package com.example.attendance_system

/**
 * Asama 3 protokolu (docs/protocol.md, bolum 4): ogrenci kodu S.
 *
 *   msg_s = "STU" || major (2 bayt) || C (2 bayt)      -> 7 bayt
 *   S     = HMAC-SHA256(ogrenci_anahtari, msg_s)       -> 32 bayt
 *
 * major: beacon'in major alani (derslik numarasi, or. 203)
 * C    : beacon'in minor alani (ESP32'nin 30 sn'de bir degistirdigi sinif kodu)
 * Sayilar big-endian yazilir (once yuksek bayt), iBeacon'daki gibi.
 *
 * ESP32 ve Cloud Function ayni bayt duzenini kullanmak zorunda; degisirse
 * docs/protocol.md ve test vektorleri de guncellenmeli.
 */
object AttendanceCode {

    private val STUDENT_PREFIX = "STU".toByteArray(Charsets.US_ASCII)

    /** Imzalanacak 7 baytlik mesaji kurar. */
    fun studentMessage(major: Int, classCode: Int): ByteArray {
        require(major in 0..0xFFFF) { "major 0-65535 arasinda olmali: $major" }
        require(classCode in 0..0xFFFF) { "classCode 0-65535 arasinda olmali: $classCode" }
        return STUDENT_PREFIX + byteArrayOf(
            (major shr 8).toByte(), major.toByte(),
            (classCode shr 8).toByte(), classCode.toByte()
        )
    }

    /**
     * Anahtar Android Keystore'da, telefondan disari cikmaz; StudentKeyStore.sign()
     * HMAC-SHA256 hesaplar. Bayt duzeni AttendanceCodeTest'te test vektoruyle dogrulanir.
     */
    fun studentCode(major: Int, classCode: Int): ByteArray =
        StudentKeyStore.sign(studentMessage(major, classCode))
}
