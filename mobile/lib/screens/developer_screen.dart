import 'package:flutter/material.dart';

import '../beacon_controller.dart';
import '../demo_data.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Gelistirici ekrani: demo anahtarlari, gorulen beacon'lar (RSSI, mesafe),
/// tum giris/cikis gecmisi. Normal kullanici icin degil; test ve rapor icin.
class DeveloperScreen extends StatelessWidget {
  const DeveloperScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final beacon = BeaconController.instance;
    final demo = DemoSettings.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Geliştirici')),
      body: ListenableBuilder(
        listenable: Listenable.merge([beacon, demo.enabled, demo.simulateInClass]),
        builder: (context, _) {
          final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
            children: [
              const SectionTitle('Demo modu'),
              Card(
                child: Column(
                  children: [
                    SwitchListTile(
                      value: demo.enabled.value,
                      onChanged: demo.setEnabled,
                      title: const Text('Demo verilerini göster'),
                      subtitle: const Text('Ders programı, istatistikler ve geçmiş için örnek veri'),
                    ),
                    SwitchListTile(
                      value: demo.simulateInClass.value,
                      onChanged: demo.enabled.value ? demo.setSimulateInClass : null,
                      title: const Text('Sınıfta görün'),
                      subtitle: const Text('Beacon görülmese de Ana Sayfa "Sınıftasın" gösterir'),
                    ),
                  ],
                ),
              ),
              SectionTitle('Görülen beacon\'lar',
                  trailing: StatusChip(
                    beacon.isScanning ? 'Tarama açık' : 'Tarama kapalı',
                    color: beacon.isScanning ? AppColors.success : AppColors.warning,
                  )),
              Card(
                child: beacon.beacons.isEmpty
                    ? const EmptyHint(
                        icon: Icons.sensors_off,
                        text: 'Şu an beacon görülmüyor. ESP32 açık ve yakında mı?')
                    : Column(
                        children: [
                          for (final b in beacon.beacons)
                            ListTile(
                              leading: const Icon(Icons.sensors, color: AppColors.sky),
                              title: Text('Sınıf ${b.major}',
                                  style: const TextStyle(fontWeight: FontWeight.w600)),
                              subtitle: Text('minor ${b.minor}'),
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text('${b.rssi} dBm',
                                      style: const TextStyle(fontWeight: FontWeight.w700)),
                                  Text('~${b.distance.toStringAsFixed(1)} m',
                                      style: TextStyle(color: muted, fontSize: 12)),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
              const SectionTitle('Tüm giriş / çıkış geçmişi'),
              Card(
                child: beacon.history.isEmpty
                    ? const EmptyHint(icon: Icons.history, text: 'Henüz olay yok.')
                    : Column(
                        children: [
                          for (final line in beacon.history)
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              child: Row(children: [
                                Expanded(
                                    child: Text(line,
                                        style: const TextStyle(fontFamily: 'monospace'))),
                              ]),
                            ),
                        ],
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}
