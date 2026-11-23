import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'auth_gate.dart';
import 'demo_data.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Android'de ayarlar android/app/google-services.json dosyasindan okunur
  await Firebase.initializeApp();
  // Gelistirici ekranindaki demo anahtarlarinin son durumu
  await DemoSettings.instance.load();
  runApp(const AttendanceApp());
}

class AttendanceApp extends StatelessWidget {
  const AttendanceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Yoklama Sistemi',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system, // telefon karanlik moddaysa uygulama da karanlik
      home: const AuthGate(),
    );
  }
}
