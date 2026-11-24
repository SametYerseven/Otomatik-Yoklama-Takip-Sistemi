import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Giris yapmis ogrencinin profili (StudentAccounts/{uid}).
class StudentProfile {
  final String uid;
  final String studentNo;
  final String name;
  final String email;

  const StudentProfile({
    required this.uid,
    required this.studentNo,
    required this.name,
    required this.email,
  });
}

/// Giristen sonra telefonun durumu.
enum DeviceStatus {
  /// Her sey hazir: anahtar bu telefonda, sunucuda da kopyasi var.
  ready,

  /// Bu telefon baska bir ogrencinin hesabina bagli.
  boundToOtherStudent,

  /// Bu hesabin anahtari baska bir telefonda olusturulmus.
  accountOnOtherDevice,

  /// Hesap var ama profil kaydi yok (kayit yarida kesilmis).
  profileMissing,
}

class DeviceCheckResult {
  final DeviceStatus status;
  final StudentProfile? profile;
  const DeviceCheckResult(this.status, [this.profile]);
}

/// Kullaniciya gosterilecek, Turkce hata mesaji tasiyan hata.
/// [field] doluysa formda o alan da isaretlenir (or. 'studentNo').
class StudentError implements Exception {
  final String message;
  final String? field;
  final String? fieldMessage;
  const StudentError(this.message, {this.field, this.fieldMessage});
  @override
  String toString() => message;
}

/// Firebase Authentication + Realtime Database + Kotlin anahtar deposu islemleri.
///
/// Veritabani dugumleri:
///   StudentAccounts/{uid}   : { studentNo, name, email, createdAt, keyCreatedAt? }
///   StudentNumbers/{ogrNo}  : uid   (bir numara tek hesaba ait olsun diye)
///   StudentSecrets/{uid}    : { key, createdAt }   (ogrenci OKUYAMAZ, sadece sunucu)
class StudentService {
  StudentService._();
  static final instance = StudentService._();

  static const _databaseUrl =
      'https://otomatik-yoklama-takip-sistemi-default-rtdb.europe-west1.firebasedatabase.app/';

  // Kotlin tarafindaki MainActivity.kt ile ayni kanal adi
  static const _keyChannel = MethodChannel('attendance/student_key');

  final _auth = FirebaseAuth.instance;
  late final _db = FirebaseDatabase.instanceFor(app: Firebase.app(), databaseURL: _databaseUrl);

  /// Kayit sirasinda true. Bu surede giris ekrani "hesap hazirlaniyor" gosterir,
  /// cunku Firebase kullaniciyi profil yazilmadan once "giris yapti" sayar.
  final registering = ValueNotifier<bool>(false);

  // Bir kez olusturulur: her cagrida yeni akis verilirse StreamBuilder bastan
  // baslar, kisa bir an "yukleniyor" gosterir ve acik ekran (or. kayit formu) kapanir.
  late final Stream<User?> authChanges = _auth.authStateChanges();

  // ---------------------------------------------------------------- Giris

  Future<void> signIn(String email, String password) async {
    try {
      await _auth.signInWithEmailAndPassword(email: email.trim(), password: password);
    } on FirebaseAuthException catch (e) {
      throw StudentError(_authMessage(e));
    }
  }

  Future<void> sendPasswordReset(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email.trim());
    } on FirebaseAuthException catch (e) {
      throw StudentError(_authMessage(e));
    }
  }

  Future<void> signOut() => _auth.signOut();

  // ---------------------------------------------------------------- Kayit

  Future<void> register({
    required String name,
    required String studentNo,
    required String email,
    required String password,
  }) async {
    registering.value = true;
    User? user;
    try {
      // 1) Firebase Authentication hesabi
      final credential = await _auth.createUserWithEmailAndPassword(
          email: email.trim(), password: password);
      user = credential.user!;

      // 2) Ogrenci numarasini bu hesaba ayir. Numara baska hesaptaysa islem iptal.
      final claim = await _db.ref('StudentNumbers/$studentNo').runTransaction((current) {
        if (current == null || current == user!.uid) return Transaction.success(user!.uid);
        return Transaction.abort();
      });
      if (!claim.committed) {
        throw const StudentError(
          'Bu öğrenci numarası başka bir hesaba kayıtlı. Bu numara sizinse ve hesabınıza '
          'erişemiyorsanız "Giriş yap" sekmesindeki "Şifremi unuttum"u kullanın ya da '
          'öğretmeninize başvurun.',
          field: 'studentNo',
          fieldMessage: 'Bu numara kullanımda',
        );
      }

      // 3) Profil
      await _db.ref('StudentAccounts/${user.uid}').set({
        'studentNo': studentNo,
        'name': name.trim(),
        'email': email.trim(),
        'createdAt': ServerValue.timestamp,
      });
    } catch (e) {
      // Yarim kalan hesabi sil ki ayni e-postayla tekrar denenebilsin
      if (user != null) {
        try {
          await _db.ref('StudentNumbers/$studentNo').get().then((s) async {
            if (s.value == user!.uid) await s.ref.remove();
          });
          await user.delete();
        } catch (_) {}
      }
      if (e is StudentError) rethrow;
      if (e is FirebaseAuthException) throw StudentError(_authMessage(e));
      if (e is FirebaseException) throw StudentError(_databaseMessage(e));
      throw StudentError('Kayıt sırasında beklenmeyen hata: $e');
    } finally {
      registering.value = false;
    }
  }

  // ---------------------------------------------------------------- Cihaz

  /// Giristen sonra cagrilir: profili okur, telefonda anahtar yoksa olusturur.
  Future<DeviceCheckResult> prepareDevice(User user) async {
    try {
      final snapshot = await _db.ref('StudentAccounts/${user.uid}').get();
      if (!snapshot.exists) return const DeviceCheckResult(DeviceStatus.profileMissing);

      final data = Map<String, dynamic>.from(snapshot.value as Map);
      final profile = StudentProfile(
        uid: user.uid,
        studentNo: data['studentNo'].toString(),
        name: (data['name'] ?? '').toString(),
        email: (data['email'] ?? user.email ?? '').toString(),
      );

      final status = Map<String, dynamic>.from(
          await _keyChannel.invokeMethod<Map>('status') ?? const {});
      final hasKey = status['hasKey'] == true;
      final boundUid = status['boundUid'] as String?;

      if (boundUid != null && boundUid != user.uid) {
        return DeviceCheckResult(DeviceStatus.boundToOtherStudent, profile);
      }
      if (hasKey && boundUid == user.uid) {
        if (data['keyCreatedAt'] != null) {
          return DeviceCheckResult(DeviceStatus.ready, profile);
        }
        // Ogretmen paneli cihazi sifirlamis: sunucudaki kopya silinmis,
        // telefondaki anahtar artik gecersiz. Eskisini sil, yenisini olustur.
        // (Kotlin createKey, telefonda anahtar varken yenisini uretmez.)
        await _keyChannel.invokeMethod('deleteKey');
        await _createKey(profile);
        return DeviceCheckResult(DeviceStatus.ready, profile);
      }
      if (data['keyCreatedAt'] != null) {
        // Sunucuda anahtar var ama bu telefonda yok: baska telefon ya da uygulama silinip kurulmus
        return DeviceCheckResult(DeviceStatus.accountOnOtherDevice, profile);
      }

      await _createKey(profile);
      return DeviceCheckResult(DeviceStatus.ready, profile);
    } on PlatformException catch (e) {
      throw StudentError('Anahtar oluşturulamadı: ${e.message}');
    } on FirebaseException catch (e) {
      throw StudentError(_databaseMessage(e));
    }
  }

  Future<void> _createKey(StudentProfile profile) async {
    // Kotlin: anahtari uretir, Keystore'a koyar, tek seferlik base64 kopyasini verir
    final key = await _keyChannel.invokeMethod<String>(
        'createKey', {'uid': profile.uid, 'studentNo': profile.studentNo});
    try {
      await _db.ref('StudentSecrets/${profile.uid}').set({
        'key': key,
        'createdAt': ServerValue.timestamp,
      });
      await _db.ref('StudentAccounts/${profile.uid}/keyCreatedAt').set(ServerValue.timestamp);
    } catch (_) {
      // Sunucuya yazilamadiysa telefondakini de sil; sonraki giriste bastan denenir
      await _keyChannel.invokeMethod('deleteKey');
      rethrow;
    }
  }

  // ---------------------------------------------------------------- Mesajlar

  String _authMessage(FirebaseAuthException e) {
    switch (e.code) {
      case 'email-already-in-use':
        return 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin.';
      case 'invalid-email':
        return 'E-posta adresi geçersiz.';
      case 'weak-password':
        return 'Şifre çok zayıf. En az 6 karakter kullanın.';
      case 'user-not-found':
      case 'wrong-password':
      case 'invalid-credential':
        return 'E-posta veya şifre hatalı.';
      case 'user-disabled':
        return 'Bu hesap devre dışı bırakılmış.';
      case 'too-many-requests':
        return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.';
      case 'network-request-failed':
        return 'İnternet bağlantısı yok.';
      case 'operation-not-allowed':
        return 'E-posta/şifre ile giriş Firebase\'de açık değil.';
      default:
        return 'Hata: ${e.message ?? e.code}';
    }
  }

  String _databaseMessage(FirebaseException e) {
    if (e.code == 'permission-denied') {
      return 'Veritabanı bu işleme izin vermedi (kurallar).';
    }
    return 'Veritabanı hatası: ${e.message ?? e.code}';
  }
}
