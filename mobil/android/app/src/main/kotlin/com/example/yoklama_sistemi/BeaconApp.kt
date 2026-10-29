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
 * - Ilk acilista izinler verilince Flutter "start" der -> tarama baslar.
 * - Sonraki acilislarda (telefon yeniden baslatildiginda vb.) izinler zaten
 *   verilmis oldugu icin onCreate taramayi kendisi baslatir.
 */
class BeaconApp : Application() {

    companion object {
        const val TAG = "BeaconApp"

        // ESP32 kodundaki UUID ile AYNI olmali
        const val PROJECT_UUID = "6f1d3b2a-8c4e-4a7f-9b21-5d3e8a9c0f47"

        // iBeacon paket formati
        const val IBEACON_LAYOUT = "m:2-3=0215,i:4-19,i:20-21,i:22-23,p:24-24"

        const val CHANNEL_SERVICE = "beacon_service"   // kalici "Yoklama aktif" bildirimi
        const val CHANNEL_EVENT = "beacon_event"       // "Sinifa girdin / cikti" bildirimleri
        const val SERVICE_NOTIFICATION_ID = 456

        lateinit var instance: BeaconApp
            private set

        // Flutter ekrani aciksa olaylar buradan ekrana gonderilir
        var eventSink: EventChannel.EventSink? = null
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val classRegion = Region("classroom-region", Identifier.parse(PROJECT_UUID), null, null)
    private var scanningStarted = false
    private var eventNotificationId = 1000
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale("tr", "TR"))

    // Uygulama kapaliyken olan giris/cikislari, uygulama acildiginda gostermek icin
    val history = ArrayDeque<String>()

    override fun onCreate() {
        super.onCreate()
        instance = this
        createNotificationChannels()
        if (hasPermissions()) startScanning()
    }

    fun hasPermissions(): Boolean {
        val location = ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val bluetooth = Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(
                this, Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED

        return location && bluetooth
    }

    fun startScanning() {
        if (scanningStarted) return
        scanningStarted = true

        val bm = BeaconManager.getInstanceForApplication(this)
        bm.beaconParsers.clear()
        bm.beaconParsers.add(BeaconParser().setBeaconLayout(IBEACON_LAYOUT))

        // Foreground service: Android'in arka plandaki taramayi oldurmemesi icin
        // bildirim cubugunda kalici bir "Yoklama aktif" bildirimi gosterilir.
        try {
            bm.enableForegroundServiceScanning(serviceNotification(), SERVICE_NOTIFICATION_ID)
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
                recordEvent("enter", "Sınıfa girdin", "Beacon algılandı")
            }

            override fun didExitRegion(region: Region) {
                recordEvent("exit", "Sınıftan çıktın", "Beacon ~10 saniyedir görülmüyor")
            }

            override fun didDetermineStateForRegion(state: Int, region: Region) {}
        })

        bm.addRangeNotifier { beacons, _ -> sendRange(beacons) }

        bm.startMonitoring(classRegion)      // giris/cikis olaylari
        bm.startRangingBeacons(classRegion)   // her taramada RSSI, major, minor
        Log.i(TAG, "Beacon taramasi basladi")
    }

    // ------------------------------------------------------------------

    private fun recordEvent(type: String, title: String, description: String) {
        val time = timeFormat.format(Date())
        val line = "$time  $title"

        history.addFirst(line)
        while (history.size > 50) history.removeLast()

        showEventNotification(title, "$description ($time)")

        mainHandler.post {
            eventSink?.success(mapOf("type" to type, "line" to line))
        }
        Log.i(TAG, line)
    }

    private fun sendRange(beacons: Collection<Beacon>) {
        val list = beacons.map {
            mapOf(
                "major" to it.id2.toInt(),
                "minor" to it.id3.toInt(),
                "rssi" to it.rssi,
                "distance" to it.distance
            )
        }
        mainHandler.post {
            eventSink?.success(mapOf("type" to "range", "beacons" to list))
        }
    }

    // ------------------------------------------------------------------
    // Bildirimler

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "Yoklama servisi", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_EVENT, "Sınıf giriş/çıkış", NotificationManager.IMPORTANCE_HIGH)
        )
    }

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun serviceNotification(): Notification =
        NotificationCompat.Builder(this, CHANNEL_SERVICE)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Yoklama aktif")
            .setContentText("Sınıf beacon'ları arka planda dinleniyor")
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .build()

    private fun showEventNotification(title: String, text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        val notification = NotificationCompat.Builder(this, CHANNEL_EVENT)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openAppIntent())
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        nm.notify(eventNotificationId++, notification)
    }
}