import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

import 'student_service.dart';

/// Giris yapildiktan sonraki ana ekran: izinler, gorulen beacon'lar,
/// giris/cikis gecmisi.
class BeaconScreen extends StatefulWidget {
  final StudentProfile profile;
  const BeaconScreen({super.key, required this.profile});

  @override
  State<BeaconScreen> createState() => _BeaconScreenState();
}

class _BeaconScreenState extends State<BeaconScreen> with WidgetsBindingObserver {
  // Kotlin tarafindaki MainActivity.kt ile ayni kanal adlari
  static const _commands = MethodChannel('attendance/beacon');
  static const _events = EventChannel('attendance/beacon_events');

  StreamSubscription? _subscription;
  String _status = 'İzinler kontrol ediliyor...';
  bool _isScanning = false;
  List<Map> _beacons = [];
  List<String> _history = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _subscription = _events.receiveBroadcastStream().listen(_onEvent);
    _requestPermissionsAndStart();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _subscription?.cancel();
    super.dispose();
  }

  // Uygulama arka plandan one gelince, kapaliyken olan giris/cikislari yukle
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _loadHistory();
  }

  Future<void> _requestPermissionsAndStart() async {
    // 1) Temel izinler: Bluetooth tarama, konum (uygulama kullanilirken), bildirim
    final results = await [
      Permission.bluetoothScan,
      Permission.locationWhenInUse,
      Permission.notification,
    ].request();

    final basicGranted = results[Permission.bluetoothScan]!.isGranted &&
        results[Permission.locationWhenInUse]!.isGranted;

    if (!basicGranted) {
      if (!mounted) return;
      setState(() => _status =
          'Bluetooth ve konum izni gerekli. Ayarlardan izin verip uygulamayı yeniden açın.');
      return;
    }

    // 2) Arka plan konumu: Android bunu ayri soruyor, "Her zaman izin ver" secilmeli
    await Permission.locationAlways.request();

    // 3) Pil optimizasyonu muafiyeti (Samsung vb. uygulamayi oldurmesin)
    await Permission.ignoreBatteryOptimizations.request();

    // 4) Kotlin tarafinda taramayi baslat
    final started = await _commands.invokeMethod<bool>('start') ?? false;
    final alwaysGranted = await Permission.locationAlways.isGranted;

    if (!mounted) return;
    setState(() {
      _isScanning = started;
      _status = !started
          ? 'Tarama başlatılamadı (izin eksik).'
          : alwaysGranted
              ? 'Tarama aktif. Uygulamayı kapatıp test edebilirsin.'
              : 'Tarama aktif, ancak konum izni "Her zaman" değil. '
                  'Arka plan testi için Ayarlar > Uygulamalar > İzinler > Konum > "Her zaman izin ver" seç.';
    });
    _loadHistory();
  }

  Future<void> _loadHistory() async {
    final list = await _commands.invokeMethod<List>('history') ?? [];
    if (!mounted) return;
    setState(() => _history = list.cast<String>());
  }

  void _onEvent(dynamic event) {
    final data = Map<String, dynamic>.from(event as Map);
    setState(() {
      if (data['type'] == 'range') {
        _beacons = List<Map>.from(data['beacons'] as List);
      } else {
        _history.insert(0, data['line'] as String);
      }
    });
  }

  Future<void> _confirmSignOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Çıkış yap'),
        content: const Text(
            'Çıkış yapsanız da bu telefon hesabınıza bağlı kalır; tekrar giriş yapabilirsiniz.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Çıkış yap')),
        ],
      ),
    );
    if (ok == true) await StudentService.instance.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final profile = widget.profile;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Yoklama'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            tooltip: 'Çıkış yap',
            onPressed: _confirmSignOut,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: const CircleAvatar(child: Icon(Icons.person)),
              title: Text(profile.name),
              subtitle: Text('${profile.studentNo}  •  ${profile.email}'),
              trailing: const Tooltip(
                message: 'Gizli anahtar bu telefonda kayıtlı',
                child: Icon(Icons.verified_user, color: Colors.green),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Card(
            color: _isScanning ? Colors.green.shade50 : Colors.orange.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _isScanning ? Icons.bluetooth_searching : Icons.bluetooth_disabled,
                    color: _isScanning ? Colors.green : Colors.orange,
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(_status)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Şu an görülen beacon\'lar', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_beacons.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Henüz beacon görülmedi. ESP32 açık ve yakında mı?'),
            ),
          ..._beacons.map((b) => Card(
                child: ListTile(
                  leading: const Icon(Icons.sensors),
                  title: Text('Sınıf ${b['major']}   (minor ${b['minor']})'),
                  subtitle: Text(
                      'RSSI: ${b['rssi']} dBm   •   ~${(b['distance'] as num).toStringAsFixed(1)} m'),
                ),
              )),
          const SizedBox(height: 16),
          Text('Giriş / çıkış geçmişi', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_history.isEmpty)
            const Text('Henüz olay yok.')
          else
            ..._history.map((s) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(s),
                )),
        ],
      ),
    );
  }
}
