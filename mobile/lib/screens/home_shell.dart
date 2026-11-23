import 'package:flutter/material.dart';

import '../beacon_controller.dart';
import '../student_service.dart';
import 'home_screen.dart';
import 'profile_screen.dart';
import 'stats_screen.dart';

/// Giris yapildiktan sonraki iskelet: alttaki menu ile 3 sekme.
class HomeShell extends StatefulWidget {
  final StudentProfile profile;
  const HomeShell({super.key, required this.profile});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> with WidgetsBindingObserver {
  int _index = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    BeaconController.instance.start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Uygulama arka plandan one gelince: kapaliyken olan giris/cikislari ve
  // ayarlardan degistirilmis olabilecek izinleri yeniden oku
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      BeaconController.instance.loadHistory();
      BeaconController.instance.refreshPermissions();
    }
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(profile: widget.profile),
      const StatsScreen(),
      ProfileScreen(profile: widget.profile),
    ];
    return Scaffold(
      body: IndexedStack(index: _index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Ana Sayfa'),
          NavigationDestination(
              icon: Icon(Icons.insights_outlined),
              selectedIcon: Icon(Icons.insights),
              label: 'İstatistikler'),
          NavigationDestination(
              icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profil'),
        ],
      ),
    );
  }
}
