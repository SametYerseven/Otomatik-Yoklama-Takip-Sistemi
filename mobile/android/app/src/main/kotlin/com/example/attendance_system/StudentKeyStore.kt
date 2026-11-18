package com.example.attendance_system

import android.content.Context
import android.security.keystore.KeyProperties
import android.security.keystore.KeyProtection
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Ogrencinin gizli anahtari (HMAC-SHA256) burada tutulur.
 *
 * - Anahtar kayitta bir kez uretilir. Bir kopyasi sunucuya (StudentSecrets/{uid})
 *   gonderilsin diye Flutter'a SADECE O AN base64 olarak verilir.
 * - Telefondaki kopya Android Keystore'a aktarilir. Keystore'a giren anahtar bir
 *   daha disari cikarilamaz; uygulama sadece "su mesaji imzala" diyebilir.
 *   Boylece anahtar telefondan kopyalanip baska telefona tasinamaz.
 * - Bir telefon ayni anda tek bir ogrenciye baglidir (bound_uid).
 * - Asama 3'te arka planda ogrenci kodu sign() ile uretilecek; bu yuzden
 *   bu kod Dart'ta degil Kotlin'de (uygulama kapaliyken de calisabilsin).
 */
object StudentKeyStore {

    private const val KEY_ALIAS = "student_hmac_key"
    private const val PREFS = "student_key"
    private const val PREF_BOUND_UID = "bound_uid"
    private const val PREF_STUDENT_NO = "student_no"
    private const val KEY_SIZE_BYTES = 32   // 256 bit

    private fun keyStore(): KeyStore =
        KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun hasKey(): Boolean = keyStore().containsAlias(KEY_ALIAS)

    /**
     * Telefonun bagli oldugu ogrencinin uid'si. Anahtar yoksa (or. yedekten geri
     * yuklenmis ayarlar) baglanti gecersiz sayilir ve temizlenir.
     */
    fun boundUid(context: Context): String? {
        val uid = prefs(context).getString(PREF_BOUND_UID, null)
        if (uid != null && !hasKey()) {
            prefs(context).edit().clear().apply()
            return null
        }
        return uid
    }

    fun studentNo(context: Context): String? =
        prefs(context).getString(PREF_STUDENT_NO, null)

    /**
     * Yeni anahtar uretir, Keystore'a koyar, telefonu bu ogrenciye baglar ve
     * anahtarin base64 halini dondurur (sunucuya gonderilmek uzere, tek seferlik).
     */
    fun createKey(context: Context, uid: String, studentNo: String): String {
        val bound = boundUid(context)
        require(bound == null || bound == uid) { "Bu cihaz baska bir ogrenciye bagli" }
        require(!hasKey()) { "Bu cihazda zaten bir anahtar var" }

        val keyBytes = ByteArray(KEY_SIZE_BYTES).also { SecureRandom().nextBytes(it) }
        try {
            val secretKey = SecretKeySpec(keyBytes, KeyProperties.KEY_ALGORITHM_HMAC_SHA256)
            keyStore().setEntry(
                KEY_ALIAS,
                KeyStore.SecretKeyEntry(secretKey),
                KeyProtection.Builder(KeyProperties.PURPOSE_SIGN).build()
            )
            prefs(context).edit()
                .putString(PREF_BOUND_UID, uid)
                .putString(PREF_STUDENT_NO, studentNo)
                .apply()
            return Base64.encodeToString(keyBytes, Base64.NO_WRAP)
        } finally {
            keyBytes.fill(0)   // ham anahtari bellekte birakma
        }
    }

    /** Sadece kayit yarim kalirsa (sunucuya yazilamazsa) geri almak icin. */
    fun deleteKey(context: Context) {
        keyStore().deleteEntry(KEY_ALIAS)
        prefs(context).edit().clear().apply()
    }

    /** HMAC-SHA256(anahtar, mesaj). Asama 3'te ogrenci kodunu uretmek icin. */
    fun sign(message: ByteArray): ByteArray {
        val key = keyStore().getKey(KEY_ALIAS, null)
            ?: throw IllegalStateException("Anahtar yok")
        return Mac.getInstance("HmacSHA256").run {
            init(key)
            doFinal(message)
        }
    }
}
