package com.example.attendance_system

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter (Dart) ile Android (Kotlin) arasindaki kopru.
 *  - MethodChannel  "attendance/beacon"         : Dart -> Kotlin komutlari (start, history)
 *  - EventChannel   "attendance/beacon_events" : Kotlin -> Dart canli olay akisi
 *  - MethodChannel  "attendance/student_key"   : gizli anahtar (status, createKey, deleteKey)
 */
class MainActivity : FlutterActivity() {

    // Bu ekranin olay baglantisi. Ekran kapaninca (uygulama kaydirilip kapatilinca)
    // Dart "dinlemeyi biraktim" diyemeden yok olur; temizligi burada yapariz ki
    // BeaconApp olaylari olmus ekrana gondermeye calismasin. Tarama etkilenmez.
    private var mySink: EventChannel.EventSink? = null

    private fun releaseSink() {
        // Yeni ekran coktan baglandiysa onun baglantisini silme
        if (BeaconApp.eventSink === mySink) BeaconApp.eventSink = null
        mySink = null
    }

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        releaseSink()
        super.cleanUpFlutterEngine(flutterEngine)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        MethodChannel(messenger, "attendance/beacon").setMethodCallHandler { call, result ->
            val app = BeaconApp.instance
            when (call.method) {
                "start" -> {
                    if (app.hasPermissions()) {
                        app.startScanning()
                        result.success(true)
                    } else {
                        result.success(false)
                    }
                }
                "history" -> result.success(app.history.toList())
                else -> result.notImplemented()
            }
        }

        // Ogrencinin gizli anahtari (bkz. StudentKeyStore.kt)
        MethodChannel(messenger, "attendance/student_key").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "status" -> result.success(
                        mapOf(
                            "hasKey" to StudentKeyStore.hasKey(),
                            "boundUid" to StudentKeyStore.boundUid(this)
                        )
                    )
                    "createKey" -> result.success(
                        StudentKeyStore.createKey(
                            this,
                            call.argument<String>("uid")!!,
                            call.argument<String>("studentNo")!!
                        )
                    )
                    "deleteKey" -> {
                        StudentKeyStore.deleteKey(this)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("student_key", e.message, null)
            }
        }

        EventChannel(messenger, "attendance/beacon_events").setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    mySink = events
                    BeaconApp.eventSink = events
                }

                override fun onCancel(arguments: Any?) {
                    releaseSink()
                }
            }
        )
    }
}