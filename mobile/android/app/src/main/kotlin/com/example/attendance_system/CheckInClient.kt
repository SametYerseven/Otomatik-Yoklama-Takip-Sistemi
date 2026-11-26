package com.example.attendance_system

import android.util.Base64
import android.util.Log
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException

/**
 * Asama 3: sunucudaki `checkIn` callable fonksiyonunu cagirir (docs/protocol.md bolum 5-6).
 *
 * - Kotlin'de, cunku uygulama kapaliyken Flutter calismiyor; tarama da burada.
 * - Firebase Functions kutuphanesi giris yapmis ogrencinin kimligini (ID token) istege
 *   kendisi ekler; sunucu `uid`'i oradan ogrenir. Biz sadece veriyi gondeririz.
 * - Basarisiz istek tekrar denenmez/kuyruga alinmaz: sinif kodu kisa surede gecersiz olur.
 *
 * Henuz taramaya baglanmadi; ne zaman cagrilacagi (60 sn, en guclu beacon) sonraki adim.
 */
object CheckInClient {

    private const val TAG = "CheckInClient"
    private const val REGION = "europe-west1"
    private const val FUNCTION_NAME = "checkIn"

    /** Bir gonderimin sonucu. */
    sealed class Result {
        /** Yoklamaya yazildi. */
        object Ok : Result()

        /** Bu zaman dilimi icin zaten kayit var; bir sey yapilmadi. */
        object Duplicate : Result()

        /** O derslikte su an ders yok; yazilmadi. */
        object NoSession : Result()

        /** Sunucuda bu hesabin anahtari yok (ogretmen cihazi sifirlamis). */
        object NoKey : Result()

        /** Sunucu istegi reddetti (kod yanlis, ogrenci degil, giris yok...). */
        data class Rejected(val reason: String) : Result()

        /** Istek sunucuya ulasmadi ya da beklenmeyen bir hata oldu (internet yok vb.). */
        data class Failed(val message: String) : Result()
    }

    /**
     * Gorulen beacon icin ogrenci kodunu uretip sunucuya gonderir.
     * [onDone] ana is parcaciginda (main thread) cagrilir.
     */
    fun send(major: Int, classCode: Int, rssi: Int, onDone: (Result) -> Unit) {
        val studentCode = try {
            Base64.encodeToString(AttendanceCode.studentCode(major, classCode), Base64.NO_WRAP)
        } catch (e: Exception) {
            // Telefonda anahtar yok ya da major/minor gecersiz: sunucuya hic gitme
            onDone(Result.Failed("Ogrenci kodu uretilemedi: ${e.message}"))
            return
        }

        val data = hashMapOf(
            "room" to major,
            "classCode" to classCode,
            "studentCode" to studentCode,
            "rssi" to rssi
        )

        FirebaseFunctions.getInstance(REGION)
            .getHttpsCallable(FUNCTION_NAME)
            .call(data)
            .addOnSuccessListener { response -> onDone(parseResponse(response.getData())) }
            .addOnFailureListener { e ->
                val result = if (e is FirebaseFunctionsException) {
                    classifyError(e.code.name, e.message)
                } else {
                    Result.Failed(e.message ?: e.toString())
                }
                Log.w(TAG, "checkIn basarisiz: $result")
                onDone(result)
            }
    }

    /** Basarili yanit: { result: "ok" | "duplicate" | "no-session" } */
    internal fun parseResponse(data: Any?): Result =
        when ((data as? Map<*, *>)?.get("result")) {
            "ok" -> Result.Ok
            "duplicate" -> Result.Duplicate
            "no-session" -> Result.NoSession
            else -> Result.Failed("Beklenmeyen yanit: $data")
        }

    /**
     * Hata yaniti. Sunucu nedeni hata mesajina yazar (or. "class-code", "no-key"),
     * bkz. docs/protocol.md bolum 6. [code] hata kodunun adidir (or. "PERMISSION_DENIED");
     * Firebase'in Code sinifi Android'e bagli oldugu icin birim testinde ad kullaniliyor.
     */
    internal fun classifyError(code: String, message: String?): Result =
        when (code) {
            "FAILED_PRECONDITION" ->
                if (message == "no-key") Result.NoKey else Result.Rejected("$code: $message")
            "UNAUTHENTICATED", "PERMISSION_DENIED", "INVALID_ARGUMENT" ->
                Result.Rejected("$code: $message")
            else -> Result.Failed("$code: $message")
        }
}
