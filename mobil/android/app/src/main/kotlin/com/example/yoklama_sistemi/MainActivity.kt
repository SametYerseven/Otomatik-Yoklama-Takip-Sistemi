package com.example.yoklama_sistemi

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter (Dart) ile Android (Kotlin) arasindaki kopru.
 *  - MethodChannel  "yoklama/beacon"         : Dart -> Kotlin komutlari (baslat, gecmis)
 *  - EventChannel   "yoklama/beacon_olaylar" : Kotlin -> Dart canli olay akisi
 */
class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger

        MethodChannel(messenger, "yoklama/beacon").setMethodCallHandler { call, result ->
            val app = BeaconApp.ornek
            when (call.method) {
                "baslat" -> {
                    if (app.izinlerTamam()) {
                        app.taramayiBaslat()
                        result.success(true)
                    } else {
                        result.success(false)
                    }
                }
                "gecmis" -> result.success(app.gecmis.toList())
                else -> result.notImplemented()
            }
        }

        EventChannel(messenger, "yoklama/beacon_olaylar").setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    BeaconApp.olaySink = events
                }

                override fun onCancel(arguments: Any?) {
                    BeaconApp.olaySink = null
                }
            }
        )
    }
}