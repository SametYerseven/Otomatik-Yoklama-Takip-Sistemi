package com.example.attendance_system

import android.content.Context
import android.os.Build
import android.util.Log
import org.altbeacon.beacon.Beacon
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * ML veri toplama modu (CLAUDE.md "ML veri toplama plani"): her tarama turunda (~1,1 sn)
 * gorulen proje beacon'larinin RSSI'sini CSV dosyasina yazar.
 *
 * - BeaconApp'in range notifier'i her turda log() cagirir; uygulama/ekran kapaliyken de
 *   calisir (tarama foreground service'te).
 * - Sutunlar iOS ile AYNI: time,platform,phone_model,room,rssi,label,location,carry
 *   (ml/ml_pipeline/ml_pipeline/train.py bu dosyalari okur).
 * - RSSI: AltBeacon'in Beacon.getRssi() degeri = o turda alinan SON paketin RSSI'si (ham).
 *   Mesafe hesabinda kullanilan ~20 sn'lik ortalama getRunningAverageRssi()'dir; o YAZILMAZ.
 * - Beacon o turda duyulmadiysa satir yazilmaz (iPhone'daki 0 satirlarinin karsiligi).
 * - Dosyalar: <harici uygulama klasoru>/rssi klasorundeki .csv dosyalari; FileProvider ile
 *   paylasilir. (Not: Kotlin'de yorum icinde "/" + "*" yeni bir yorum acar, yazilmamali.)
 */
object RssiLogger {

    private const val TAG = "RssiLogger"
    private const val HEADER = "time,platform,phone_model,room,rssi,label,location,carry"
    private val SAFE_TEXT = Regex("^[a-z0-9_]{1,40}$")

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }
    private val nameFormat = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)

    // Telefon modeli CSV'yi bozmasin diye virgul/bosluk temizlenir (or. "SM-S928B")
    private val phoneModel: String = Build.MODEL.replace(Regex("[^A-Za-z0-9_.-]"), "_")

    private var writer: BufferedWriter? = null
    private var file: File? = null
    private var label = 0
    private var location = ""
    private var carry = ""
    private var rows = 0
    private var startedAt = 0L
    private var lastRssi: Int? = null
    private var lastAt = 0L

    fun dir(context: Context): File =
        File(context.getExternalFilesDir(null) ?: context.filesDir, "rssi").apply { mkdirs() }

    /** Yeni kayit baslatir (acik kayit varsa once kapatir). Dosya adini dondurur. */
    @Synchronized
    fun start(context: Context, label: Int, location: String, carry: String): String {
        require(label == 0 || label == 1) { "label 0 ya da 1 olmali" }
        require(SAFE_TEXT.matches(location)) { "location sadece kucuk harf, rakam ve _ icermeli" }
        require(SAFE_TEXT.matches(carry)) { "carry sadece kucuk harf, rakam ve _ icermeli" }
        stopLocked()

        val name = "${nameFormat.format(Date())}_${phoneModel}_${location}_$carry.csv"
        val f = File(dir(context), name)
        writer = BufferedWriter(FileWriter(f)).apply {
            write(HEADER)
            newLine()
            flush()
        }
        file = f
        this.label = label
        this.location = location
        this.carry = carry
        rows = 0
        startedAt = System.currentTimeMillis()
        lastRssi = null
        lastAt = 0L
        Log.i(TAG, "Kayit basladi: $name")
        return name
    }

    /** BeaconApp her tarama turunda cagirir. Kayit yoksa hicbir sey yapmaz. */
    @Synchronized
    fun log(beacons: Collection<Beacon>) {
        val w = writer ?: return
        if (beacons.isEmpty()) return
        val now = System.currentTimeMillis()
        val time = isoFormat.format(Date(now))
        try {
            for (b in beacons) {
                w.write("$time,android,$phoneModel,${b.id2.toInt()},${b.rssi},$label,$location,$carry")
                w.newLine()
                rows++
                lastRssi = b.rssi
            }
            w.flush()   // uygulama aniden kapanirsa veri kaybolmasin
            lastAt = now
        } catch (e: Exception) {
            Log.e(TAG, "Yazilamadi", e)
        }
    }

    @Synchronized
    fun stop(): Map<String, Any?> {
        val result = status()
        stopLocked()
        return result
    }

    private fun stopLocked() {
        try {
            writer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "Kapatilamadi: ${e.message}")
        }
        if (writer != null) Log.i(TAG, "Kayit bitti: ${file?.name}, $rows satir")
        writer = null
    }

    @Synchronized
    fun status(): Map<String, Any?> = mapOf(
        "recording" to (writer != null),
        "file" to file?.name,
        "rows" to rows,
        "label" to label,
        "location" to location,
        "carry" to carry,
        "startedAt" to startedAt,
        "lastRssi" to lastRssi,
        "lastAt" to lastAt,
        "platform" to "android",
        "phoneModel" to phoneModel
    )

    /** Kayitli dosyalar, yeniden eskiye. */
    fun files(context: Context): List<Map<String, Any>> =
        (dir(context).listFiles { f -> f.name.endsWith(".csv") } ?: emptyArray())
            .sortedByDescending { it.lastModified() }
            .map { mapOf("name" to it.name, "size" to it.length(), "modified" to it.lastModified()) }

    /** Ad dogrulanir: klasor disina cikilamasin. */
    fun fileByName(context: Context, name: String): File {
        require(name.endsWith(".csv") && !name.contains('/') && !name.contains('\\')) { "gecersiz dosya adi" }
        return File(dir(context), name)
    }

    @Synchronized
    fun delete(context: Context, name: String): Boolean {
        val f = fileByName(context, name)
        if (writer != null && f == file) return false   // kaydi suren dosya silinmez
        return f.delete()
    }
}
