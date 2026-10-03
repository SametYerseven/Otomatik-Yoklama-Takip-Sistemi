package com.example.yoklama_sistemi

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import io.flutter.plugin.common.EventChannel
import org.altbeacon.beacon.Beacon
import org.altbeacon.beacon.BeaconManager
import org.altbeacon.beacon.BeaconParser
import org.altbeacon.beacon.Identifier
import org.altbeacon.beacon.MonitorNotifier
import org.altbeacon.beacon.Region
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Uygulama surecinin kendisi. Uygulama ekrani kapali olsa bile (arka planda,
 * telefon cepteyken) beacon taramasi burada calisir.
 *
 * - Ilk acilista izinler verilince Flutter "baslat" der -> tarama baslar.
 * - Sonraki acilislarda (telefon yeniden baslatildiginda vb.) izinler zaten
 *   verilmis oldugu icin onCreate taramayi kendisi baslatir.
 */
class BeaconApp : Application() {

    companion object {
        const val TAG = "BeaconApp"

        // ESP32 kodundaki UUID ile AYNI olmali
        const val PROJE_UUID = "6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47"

        // iBeacon paket formati
        const val IBEACON_DUZENI = "m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24"

        const val KANAL_SERVIS = "beacon_servis"   // kalici "Yoklama aktif" bildirimi
        const val KANAL_OLAY = "beacon_olay"       // "Sinifa girdin / cikti" bildirimleri
        const val SERVIS_BILDIRIM_ID = 456

        lateinit var ornek: BeaconApp
            private set

        // Flutter ekrani aciksa olaylar buradan ekrana gonderilir
        var olaySink: EventChannel.EventSink? = null
    }

    private val anaThread = Handler(Looper.getMainLooper())
    private val bolge = Region("sinif-bolgesi", Identifier.parse(PROJE_UUID), null, null)
    private var taramaBasladi = false
    private var olayBildirimId = 1000
    private val saatFormati = SimpleDateFormat("HH:mm:ss", Locale("tr", "TR"))

    // Uygulama kapaliyken olan giris/cikislari, uygulama acildiginda gostermek icin
    val gecmis = ArrayDeque<String>()

    override fun onCreate() {
        super.onCreate()
        ornek = this
        bildirimKanallariniOlustur()
        if (izinlerTamam()) taramayiBaslat()
    }

    fun izinlerTamam(): Boolean {
        val konum = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val bluetooth = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED

        return konum && bluetooth
    }

    fun taramayiBaslat() {
        if (taramaBasladi) return
        taramaBasladi = true

        val bm = BeaconManager.getInstanceForApplication(this)
        bm.beaconParsers.clear()
        bm.beaconParsers.add(BeaconParser().setBeaconLayout(IBEACON_DUZENI))

        // Foreground service: Android'in arka plandaki taramayi oldurmemesi icin
        // bildirim cubugunda kalici bir "Yoklama aktif" bildirimi gosterilir.
        try {
            bm.enableForegroundServiceScanning(servisBildirimi(), SERVIS_BILDIRIM_ID)
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Foreground service zaten ayarli: ${e.message}")
        }
        bm.setEnableScheduledScanJobs(false)

        // Her 1.1 saniyede bir tarama, arada bekleme yok (test icin hizli algilama)
        bm.setForegroundScanPeriod(1100L)
        bm.setForegroundBetweenScanPeriod(0L)
        bm.setBackgroundScanPeriod(1100L)
        bm.setBackgroundBetweenScanPeriod(0L)

        bm.addMonitorNotifier(object : MonitorNotifier {
            override fun didEnterRegion(region: Region) {
                olayKaydet("giris", "Sınıfa girdin", "Beacon algılandı")
            }

            override fun didExitRegion(region: Region) {
                olayKaydet("cikis", "Sınıftan çıktın", "Beacon ~10 saniyedir görülmüyor")
            }

            override fun didDetermineStateForRegion(state: Int, region: Region) {}
        })

        bm.addRangeNotifier { beaconlar, _ -> araligiGonder(beaconlar) }

        bm.startMonitoring(bolge)       // giris/cikis olaylari
        bm.startRangingBeacons(bolge)   // her taramada RSSI, major, minor
        Log.i(TAG, "Beacon taramasi basladi")
    }

    // ------------------------------------------------------------------

    private fun olayKaydet(tip: String, baslik: String, aciklama: String) {
        val saat = saatFormati.format(Date())
        val satir = "$saat  $baslik"

        gecmis.addFirst(satir)
        while (gecmis.size > 50) gecmis.removeLast()

        olayBildirimiGoster(baslik, "$aciklama ($saat)")

        anaThread.post {
            olaySink?.success(mapOf("tip" to tip, "satir" to satir))
        }
        Log.i(TAG, satir)
    }

    private fun araligiGonder(beaconlar: Collection<Beacon>) {
        val liste = beaconlar.map {
            mapOf(
                "major" to it.id2.toInt(),
                "minor" to it.id3.toInt(),
                "rssi" to it.rssi,
                "mesafe" to it.distance
            )
        }
        anaThread.post {
            olaySink?.success(mapOf("tip" to "aralik", "beaconlar" to liste))
        }
    }

    // ------------------------------------------------------------------
    // Bildirimler

    private fun bildirimKanallariniOlustur() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(KANAL_SERVIS, "Yoklama servisi", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(KANAL_OLAY, "Sınıf giriş/çıkış", NotificationManager.IMPORTANCE_HIGH)
        )
    }

    private fun uygulamayiAcIntenti(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun servisBildirimi(): Notification =
        NotificationCompat.Builder(this, KANAL_SERVIS)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Yoklama aktif")
            .setContentText("Sınıf beacon'ları arka planda dinleniyor")
            .setContentIntent(uygulamayiAcIntenti())
            .setOngoing(true)
            .build()

    private fun olayBildirimiGoster(baslik: String, metin: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val bildirim = NotificationCompat.Builder(this, KANAL_OLAY)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(baslik)
            .setContentText(metin)
            .setContentIntent(uygulamayiAcIntenti())
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        nm.notify(olayBildirimId++, bildirim)
    }
}