import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'auth_gate.dart';
import 'demo_data.dart';
import 'screens/data_collection_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Android'de ayarlar android/app/google-services.json dosyasindan okunur.
  // iOS'ta GoogleService-Info.plist henuz yok: Firebase baslamazsa uygulama sadece
  // ML veri toplama moduyla acilir (giris/kayit olmadan).
  var firebaseReady = true;
  try {
    await Firebase.initializeApp();
  } catch (e) {
    firebaseReady = false;
    debugPrint('Firebase baslatilamadi, sadece veri toplama modu: $e');
  }
  // Gelistirici ekranindaki demo anahtarlarinin son durumu
  await DemoSettings.instance.load();
  runApp(AttendanceApp(firebaseReady: firebaseReady));
}

class AttendanceApp extends StatelessWidget {
  final bool firebaseReady;
  const AttendanceApp({super.key, this.firebaseReady = true});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Yoklama Sistemi',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system, // telefon karanlik moddaysa uygulama da karanlik
      home: firebaseReady ? const AuthGate() : const DataCollectionScreen(standalone: true),
    );
  }
}
