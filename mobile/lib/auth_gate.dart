import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'auth_screen.dart';
import 'screens/home_shell.dart';
import 'student_service.dart';

/// Uygulamanin giris kapisi: kimin giris yaptigina gore hangi ekranin
/// gosterilecegine karar verir.
///
///   giris yok / kayit suruyor -> AuthScreen (giris / kayit)
///   giris var                 -> DeviceSetup (anahtar kontrolu) -> HomeShell
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final service = StudentService.instance;
    // Giris dinleyicisi (StreamBuilder) DISTA: registering degisince yeniden
    // baslamasin, yoksa kisa bir "yukleniyor" ekrani kayit formunu kapatir.
    return StreamBuilder<User?>(
      stream: service.authChanges,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _Loading('Yükleniyor...');
        }
        final user = snapshot.data;
        return ValueListenableBuilder<bool>(
          valueListenable: service.registering,
          builder: (context, registering, _) {
            // Kayit surerken de AuthScreen acik kalir: Firebase kullaniciyi kayit
            // bitmeden "giris yapti" sayiyor; ekran kapanirsa kayit hatasi
            // (or. numara dolu) gosterilemeden kaybolur.
            if (user == null || registering) return const AuthScreen();
            // key: farkli kullanici giris yaparsa kontrol bastan yapilsin
            return DeviceSetup(key: ValueKey(user.uid), user: user);
          },
        );
      },
    );
  }
}

/// Giristen sonra: profili okur, gerekirse gizli anahtari olusturur.
class DeviceSetup extends StatefulWidget {
  final User user;
  const DeviceSetup({super.key, required this.user});

  @override
  State<DeviceSetup> createState() => _DeviceSetupState();
}

class _DeviceSetupState extends State<DeviceSetup> {
  late Future<DeviceCheckResult> _check;

  @override
  void initState() {
    super.initState();
    _check = StudentService.instance.prepareDevice(widget.user);
  }

  void _retry() => setState(() {
        _check = StudentService.instance.prepareDevice(widget.user);
      });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<DeviceCheckResult>(
      future: _check,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const _Loading('Cihaz hazırlanıyor...');
        }
        if (snapshot.hasError) {
          return _Problem(
            title: 'Bir sorun oluştu',
            message: snapshot.error.toString(),
            onRetry: _retry,
          );
        }
        final result = snapshot.data!;
        switch (result.status) {
          case DeviceStatus.ready:
            return HomeShell(profile: result.profile!);
          case DeviceStatus.boundToOtherStudent:
            return const _Problem(
              title: 'Bu telefon başka bir öğrenciye kayıtlı',
              message: 'Her telefon yalnızca bir öğrencinin yoklaması için kullanılabilir. '
                  'Kendi hesabınızla giriş yapın.',
            );
          case DeviceStatus.accountOnOtherDevice:
            return const _Problem(
              title: 'Hesabınız başka bir telefona bağlı',
              message: 'Bu hesap daha önce başka bir telefonda (ya da uygulama silinmeden önce) '
                  'kurulmuş. Telefon değiştirdiyseniz öğretmeninize başvurun.',
            );
          case DeviceStatus.profileMissing:
            return const _Problem(
              title: 'Kayıt tamamlanmamış',
              message: 'Hesabınızın öğrenci bilgileri bulunamadı. Çıkış yapıp yeniden kayıt olmayı '
                  'deneyin; sorun sürerse öğretmeninize başvurun.',
            );
        }
      },
    );
  }
}

class _Loading extends StatelessWidget {
  final String text;
  const _Loading(this.text);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(),
            const SizedBox(height: 16),
            Text(text),
          ],
        ),
      ),
    );
  }
}

class _Problem extends StatelessWidget {
  final String title;
  final String message;
  final VoidCallback? onRetry;
  const _Problem({required this.title, required this.message, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(Icons.warning_amber_rounded,
                  size: 64, color: Theme.of(context).colorScheme.error),
              const SizedBox(height: 16),
              Text(title,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 24),
              if (onRetry != null)
                FilledButton(onPressed: onRetry, child: const Text('Tekrar dene')),
              TextButton(
                onPressed: StudentService.instance.signOut,
                child: const Text('Çıkış yap'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
