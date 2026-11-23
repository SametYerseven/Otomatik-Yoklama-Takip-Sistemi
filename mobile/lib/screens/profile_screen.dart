import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';

import '../beacon_controller.dart';
import '../student_service.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'developer_screen.dart';

/// Profil: ogrenci bilgileri, cihaz durumu, izinler, gelistirici ekrani, cikis.
class ProfileScreen extends StatelessWidget {
  final StudentProfile profile;
  const ProfileScreen({super.key, required this.profile});

  @override
  Widget build(BuildContext context) {
    final beacon = BeaconController.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Profil')),
      body: ListenableBuilder(
        listenable: beacon,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
          children: [
            _ProfileCard(profile: profile),
            const SectionTitle('Cihaz'),
            Card(
              child: Column(
                children: [
                  const _InfoRow(
                    icon: Icons.verified_user,
                    color: AppColors.success,
                    title: 'Gizli anahtar bu telefonda',
                    subtitle: 'Telefonun hesabına bağlı. Yoklama sadece bu telefondan verilebilir.',
                  ),
                  const Divider(height: 1, indent: 16, endIndent: 16),
                  _InfoRow(
                    icon: beacon.isScanning ? Icons.bluetooth_searching : Icons.bluetooth_disabled,
                    color: beacon.isScanning ? AppColors.success : AppColors.warning,
                    title: beacon.isScanning ? 'Arka plan taraması açık' : 'Tarama kapalı',
                    subtitle: beacon.isScanning
                        ? 'Uygulama kapalıyken de sınıfa giriş ve çıkışın algılanır.'
                        : (beacon.problem ?? 'Gerekli izinleri vermen gerekiyor.'),
                  ),
                ],
              ),
            ),
            SectionTitle('İzinler',
                trailing: beacon.permissions.allGranted
                    ? const StatusChip('Tamam', color: AppColors.success)
                    : const StatusChip('Eksik var', color: AppColors.warning)),
            Card(
              child: Column(
                children: [
                  _PermissionRow(
                    granted: beacon.permissions.bluetooth,
                    title: 'Yakındaki cihazlar (Bluetooth)',
                    why: 'Sınıftaki yayını duymak için',
                  ),
                  _PermissionRow(
                    granted: beacon.permissions.locationAlways,
                    title: 'Konum: Her zaman',
                    why: 'Uygulama kapalıyken de algılama için',
                  ),
                  _PermissionRow(
                    granted: beacon.permissions.notification,
                    title: 'Bildirimler',
                    why: '"Sınıfa girdin" bildirimleri için',
                  ),
                  _PermissionRow(
                    granted: beacon.permissions.batteryUnrestricted,
                    title: 'Pil kısıtlaması yok',
                    why: 'Telefonun uygulamayı kapatmaması için',
                    onFix: () async {
                      await Permission.ignoreBatteryOptimizations.request();
                      await beacon.refreshPermissions();
                    },
                  ),
                  if (!beacon.permissions.allGranted)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      child: SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: openAppSettings,
                          icon: const Icon(Icons.settings),
                          label: const Text('Uygulama ayarlarını aç'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SectionTitle('Uygulama'),
            Card(
              child: Column(
                children: [
                  ListTile(
                    leading: const Icon(Icons.developer_mode),
                    title: const Text('Geliştirici'),
                    subtitle: const Text('Sinyal ölçümleri, demo verileri'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context)
                        .push(MaterialPageRoute(builder: (_) => const DeveloperScreen())),
                  ),
                  const Divider(height: 1, indent: 16, endIndent: 16),
                  const ListTile(
                    leading: Icon(Icons.info_outline),
                    title: Text('Hakkında'),
                    subtitle: Text('Otomatik Yoklama Takip Sistemi · Sürüm 1.0.0\n'
                        'Manisa Celal Bayar Üniversitesi · Yazılım Mühendisliği'),
                    isThreeLine: true,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            FilledButton.tonalIcon(
              style: FilledButton.styleFrom(
                foregroundColor: AppColors.red,
                backgroundColor: AppColors.red.withValues(alpha: 0.1),
              ),
              onPressed: () => _confirmSignOut(context),
              icon: const Icon(Icons.logout),
              label: const Text('Çıkış yap'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Çıkış yap'),
        content: const Text(
            'Çıkış yapsan da bu telefon hesabına bağlı kalır; tekrar giriş yapabilirsin.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Çıkış yap')),
        ],
      ),
    );
    if (ok == true) await StudentService.instance.signOut();
  }
}

class _ProfileCard extends StatelessWidget {
  final StudentProfile profile;
  const _ProfileCard({required this.profile});

  @override
  Widget build(BuildContext context) {
    final initials = profile.name
        .split(' ')
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          colors: [AppColors.navy, Color(0xFF1C6FB8)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: Colors.white,
            child: Text(initials,
                style: const TextStyle(
                    color: AppColors.navy, fontSize: 22, fontWeight: FontWeight.w800)),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(profile.name,
                    style: const TextStyle(
                        color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text(profile.studentNo,
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.9), fontSize: 15)),
                Text(profile.email,
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 13)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  const _InfoRow(
      {required this.icon, required this.color, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle),
    );
  }
}

class _PermissionRow extends StatelessWidget {
  final bool granted;
  final String title;
  final String why;
  final VoidCallback? onFix;
  const _PermissionRow({required this.granted, required this.title, required this.why, this.onFix});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(granted ? Icons.check_circle : Icons.error_outline,
          color: granted ? AppColors.success : AppColors.warning),
      title: Text(title),
      subtitle: Text(why),
      trailing: granted || onFix == null
          ? null
          : TextButton(onPressed: onFix, child: const Text('İzin ver')),
    );
  }
}
