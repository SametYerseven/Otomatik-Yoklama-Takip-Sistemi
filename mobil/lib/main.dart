import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

void main() => runApp(const YoklamaDenemeApp());

class YoklamaDenemeApp extends StatelessWidget {
  const YoklamaDenemeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Yoklama Deneme',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const BeaconEkrani(),
    );
  }
}

class BeaconEkrani extends StatefulWidget {
  const BeaconEkrani({super.key});

  @override
  State<BeaconEkrani> createState() => _BeaconEkraniState();
}

class _BeaconEkraniState extends State<BeaconEkrani> with WidgetsBindingObserver {
  // Kotlin tarafindaki MainActivity.kt ile ayni kanal adlari
  static const _komut = MethodChannel('yoklama/beacon');
  static const _olaylar = EventChannel('yoklama/beacon_olaylar');

  StreamSubscription? _abonelik;
  String _durum = 'İzinler kontrol ediliyor...';
  bool _taramaAktif = false;
  List<Map> _beaconlar = [];
  List<String> _gecmis = [];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _abonelik = _olaylar.receiveBroadcastStream().listen(_olayGeldi);
    _izinleriIsteVeBaslat();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _abonelik?.cancel();
    super.dispose();
  }

  // Uygulama arka plandan one gelince, kapaliyken olan giris/cikislari yukle
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _gecmisiYukle();
  }

  Future<void> _izinleriIsteVeBaslat() async {
    // 1) Temel izinler: Bluetooth tarama, konum (uygulama kullanilirken), bildirim
    final sonuc = await [
      Permission.bluetoothScan,
      Permission.locationWhenInUse,
      Permission.notification,
    ].request();

    final temelTamam = sonuc[Permission.bluetoothScan]!.isGranted &&
        sonuc[Permission.locationWhenInUse]!.isGranted;

    if (!temelTamam) {
      setState(() => _durum =
          'Bluetooth ve konum izni gerekli. Ayarlardan izin verip uygulamayı yeniden açın.');
      return;
    }

    // 2) Arka plan konumu: Android bunu ayri soruyor, "Her zaman izin ver" secilmeli
    await Permission.locationAlways.request();

    // 3) Pil optimizasyonu muafiyeti (Samsung vb. uygulamayi oldurmesin)
    await Permission.ignoreBatteryOptimizations.request();

    // 4) Kotlin tarafinda taramayi baslat
    final basladi = await _komut.invokeMethod<bool>('baslat') ?? false;
    final herZaman = await Permission.locationAlways.isGranted;

    setState(() {
      _taramaAktif = basladi;
      _durum = !basladi
          ? 'Tarama başlatılamadı (izin eksik).'
          : herZaman
              ? 'Tarama aktif. Uygulamayı kapatıp test edebilirsin.'
              : 'Tarama aktif, ancak konum izni "Her zaman" değil. '
                  'Arka plan testi için Ayarlar > Uygulamalar > İzinler > Konum > "Her zaman izin ver" seç.';
    });
    _gecmisiYukle();
  }

  Future<void> _gecmisiYukle() async {
    final liste = await _komut.invokeMethod<List>('gecmis') ?? [];
    setState(() => _gecmis = liste.cast<String>());
  }

  void _olayGeldi(dynamic olay) {
    final veri = Map<String, dynamic>.from(olay as Map);
    setState(() {
      if (veri['tip'] == 'aralik') {
        _beaconlar = List<Map>.from(veri['beaconlar'] as List);
      } else {
        _gecmis.insert(0, veri['satir'] as String);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Beacon Algılama Testi')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: _taramaAktif ? Colors.green.shade50 : Colors.orange.shade50,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Icon(
                    _taramaAktif ? Icons.bluetooth_searching : Icons.bluetooth_disabled,
                    color: _taramaAktif ? Colors.green : Colors.orange,
                  ),
                  const SizedBox(width: 12),
                  Expanded(child: Text(_durum)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text('Şu an görülen beacon\'lar', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_beaconlar.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text('Henüz beacon görülmedi. ESP32 açık ve yakında mı?'),
            ),
          ..._beaconlar.map((b) => Card(
                child: ListTile(
                  leading: const Icon(Icons.sensors),
                  title: Text('Sınıf ${b['major']}   (minor ${b['minor']})'),
                  subtitle: Text(
                      'RSSI: ${b['rssi']} dBm   •   ~${(b['mesafe'] as num).toStringAsFixed(1)} m'),
                ),
              )),
          const SizedBox(height: 16),
          Text('Giriş / çıkış geçmişi', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (_gecmis.isEmpty)
            const Text('Henüz olay yok.')
          else
            ..._gecmis.map((s) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(s),
                )),
        ],
      ),
    );
  }
}