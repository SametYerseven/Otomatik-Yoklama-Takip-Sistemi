import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

/// Telefonun su an gordugu bir beacon (sinif).
class SeenBeacon {
  final int major; // sinif numarasi
  final int minor;
  final int rssi;
  final double distance;
  const SeenBeacon(this.major, this.minor, this.rssi, this.distance);
}

/// Izinlerin ozet durumu (Profil ekraninda gosterilir).
class PermissionSummary {
  final bool bluetooth;
  final bool locationAlways;
  final bool notification;
  final bool batteryUnrestricted;
  const PermissionSummary({
    this.bluetooth = false,
    this.locationAlways = false,
    this.notification = false,
    this.batteryUnrestricted = false,
  });

  bool get allGranted => bluetooth && locationAlways && notification && batteryUnrestricted;
}

/// Kotlin tarafindaki beacon taramasini ekranlara baglayan tek nokta.
/// Eskiden BeaconScreen icindeydi; artik birden fazla ekran ayni veriyi
/// kullandigi icin ayri bir sinif.
class BeaconController extends ChangeNotifier {
  BeaconController._();
  static final instance = BeaconController._();

  // Kotlin tarafindaki MainActivity.kt ile ayni kanal adlari
  static const _commands = MethodChannel('attendance/beacon');
  static const _events = EventChannel('attendance/beacon_events');

  StreamSubscription? _subscription;
  bool _started = false;

  bool isScanning = false;
  String? problem; // izin eksikse kullaniciya gosterilecek aciklama
  List<SeenBeacon> beacons = [];
  List<String> history = []; // "HH:mm:ss  Sınıfa girdin" bicimindeki satirlar
  PermissionSummary permissions = const PermissionSummary();

  /// Son "sinifa girdin" olayinin zamani (sinifta degilse null).
  DateTime? enteredAt;

  /// Su an en guclu duyulan sinif (beacon gorulmuyorsa null).
  int? get currentRoom {
    if (beacons.isEmpty) return null;
    final strongest = beacons.reduce((a, b) => a.rssi >= b.rssi ? a : b);
    return strongest.major;
  }

  bool get inClass => currentRoom != null || enteredAt != null;

  /// Ilk acilista bir kez cagrilir: izinleri ister ve taramayi baslatir.
  Future<void> start() async {
    if (_started) return;
    _started = true;
    _subscription = _events.receiveBroadcastStream().listen(_onEvent);

    final results = await [
      Permission.bluetoothScan,
      Permission.locationWhenInUse,
      Permission.notification,
    ].request();

    final basicGranted = results[Permission.bluetoothScan]!.isGranted &&
        results[Permission.locationWhenInUse]!.isGranted;
    if (!basicGranted) {
      problem = 'Bluetooth ve konum izni gerekli. Profil > İzinler bölümünden izin verebilirsin.';
      await refreshPermissions();
      return;
    }

    // Arka plan konumu: Android bunu ayri soruyor, "Her zaman izin ver" secilmeli
    await Permission.locationAlways.request();
    // Pil optimizasyonu muafiyeti (Samsung vb. uygulamayi oldurmesin)
    await Permission.ignoreBatteryOptimizations.request();

    isScanning = await _commands.invokeMethod<bool>('start') ?? false;
    problem = isScanning ? null : 'Tarama başlatılamadı (izin eksik).';
    await refreshPermissions();
    await loadHistory();
  }

  Future<void> refreshPermissions() async {
    permissions = PermissionSummary(
      bluetooth: await Permission.bluetoothScan.isGranted,
      locationAlways: await Permission.locationAlways.isGranted,
      notification: await Permission.notification.isGranted,
      batteryUnrestricted: await Permission.ignoreBatteryOptimizations.isGranted,
    );
    notifyListeners();
  }

  /// Uygulama kapaliyken olan giris/cikislari Kotlin'den yukler.
  Future<void> loadHistory() async {
    final list = await _commands.invokeMethod<List>('history') ?? [];
    // Platform kanalindan gelen liste sabit uzunlukta: kopyala
    history = List<String>.from(list);
    _restoreEnteredAt();
    notifyListeners();
  }

  /// En son olay "girdin" ise giris saatini satirdan geri cikarir.
  void _restoreEnteredAt() {
    if (history.isEmpty) return;
    final last = history.first;
    if (!last.contains('girdin')) {
      enteredAt = null;
      return;
    }
    final parts = last.split(' ').first.split(':');
    if (parts.length != 3) return;
    final now = DateTime.now();
    enteredAt = DateTime(now.year, now.month, now.day,
        int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
  }

  void _onEvent(dynamic event) {
    final data = Map<String, dynamic>.from(event as Map);
    switch (data['type']) {
      case 'range':
        beacons = List<Map>.from(data['beacons'] as List)
            .map((b) => SeenBeacon(
                  b['major'] as int,
                  b['minor'] as int,
                  b['rssi'] as int,
                  (b['distance'] as num).toDouble(),
                ))
            .toList();
        if (beacons.isNotEmpty && enteredAt == null) enteredAt = DateTime.now();
      case 'enter':
        history.insert(0, data['line'] as String);
        enteredAt = DateTime.now();
      case 'exit':
        history.insert(0, data['line'] as String);
        enteredAt = null;
        beacons = [];
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
