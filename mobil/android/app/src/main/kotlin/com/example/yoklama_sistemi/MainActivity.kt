package com.example.yoklama_sistemi

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter (Dart) ile Android (Kotlin) arasindaki kopru.
 *  - MethodChannel  "attendance/beacon"         : Dart -> Kotlin komutlari (start, history)
 *  - EventChannel   "attendance/beacon_events" : Kotlin -> Dart canli olay akisi
 */
class MainActivity : FlutterActivity() {

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

        EventChannel(messenger, "attendance/beacon_events").setStreamHandler(
            object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                    BeaconApp.eventSink = events
                }

                override fun onCancel(arguments: Any?) {
                    BeaconApp.eventSink = null
                }
            }
        )
    }
}