import 'package:flutter/material.dart';

import 'screens/data_collection_screen.dart';
import 'student_service.dart';

/// Giris ve kayit ekrani. Ustteki sekmeyle ikisi arasinda gecilir.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _studentNo = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _passwordRepeat = TextEditingController();

  bool _isRegister = false;
  bool _busy = false;
  bool _hidePassword = true;
  String? _error;
  String? _studentNoError;   // sunucudan gelen numara hatasi (or. numara kullanimda)

  @override
  void dispose() {
    for (final c in [_name, _studentNo, _email, _password, _passwordRepeat]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _studentNoError = null;
    });
    if (!_formKey.currentState!.validate()) return;

    setState(() => _busy = true);
    try {
      if (_isRegister) {
        await StudentService.instance.register(
          name: _name.text,
          studentNo: _studentNo.text.trim(),
          email: _email.text,
          password: _password.text,
        );
      } else {
        await StudentService.instance.signIn(_email.text, _password.text);
      }
      // Basariliysa AuthGate kendiliginden sonraki ekrana gecer
    } on StudentError catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          if (e.field == 'studentNo') _studentNoError = e.fieldMessage;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resetPassword() async {
    final email = _email.text.trim();
    if (email.isEmpty) {
      setState(() => _error = 'Önce e-posta adresinizi yazın.');
      return;
    }
    try {
      await StudentService.instance.sendPasswordReset(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Şifre sıfırlama bağlantısı $email adresine gönderildi.')),
      );
    } on StudentError catch (e) {
      setState(() => _error = e.message);
    }
  }

  // ------------------------------------------------------------ Dogrulama

  String? _required(String? v, String field) =>
      (v == null || v.trim().isEmpty) ? '$field gerekli' : null;

  String? _validateStudentNo(String? v) {
    final value = v?.trim() ?? '';
    if (value.isEmpty) return 'Öğrenci numarası gerekli';
    if (!RegExp(r'^\d{6,12}$').hasMatch(value)) return 'Sadece rakam, 6-12 hane';
    return null;
  }

  String? _validateEmail(String? v) {
    final value = v?.trim() ?? '';
    if (value.isEmpty) return 'E-posta gerekli';
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)) return 'Geçerli bir e-posta yazın';
    return null;
  }

  String? _validatePassword(String? v) {
    if (v == null || v.isEmpty) return 'Şifre gerekli';
    if (_isRegister && v.length < 6) return 'En az 6 karakter';
    return null;
  }

  // ------------------------------------------------------------ Ekran

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Logo yazisi koyu gri; karanlik temada da okunsun diye beyaz kart icinde
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Image.asset('assets/images/cbu_logo.png', height: 72),
                    ),
                    const SizedBox(height: 24),
                    Text('Otomatik Yoklama',
                        textAlign: TextAlign.center,
                        style: Theme.of(context)
                            .textTheme
                            .headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    Text(
                      'Sınıfa girdiğinde yoklaman otomatik alınır.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65)),
                    ),
                    const SizedBox(height: 28),
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text('Giriş yap')),
                        ButtonSegment(value: true, label: Text('Kayıt ol')),
                      ],
                      selected: {_isRegister},
                      onSelectionChanged: _busy
                          ? null
                          : (s) => setState(() {
                                _isRegister = s.first;
                                _error = null;
                                _studentNoError = null;
                              }),
                    ),
                    const SizedBox(height: 24),
                    if (_isRegister) ...[
                      TextFormField(
                        controller: _name,
                        decoration: const InputDecoration(
                            labelText: 'Ad Soyad', prefixIcon: Icon(Icons.person)),
                        textCapitalization: TextCapitalization.words,
                        textInputAction: TextInputAction.next,
                        validator: (v) => _required(v, 'Ad soyad'),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _studentNo,
                        decoration: InputDecoration(
                          labelText: 'Öğrenci numarası',
                          prefixIcon: const Icon(Icons.badge),
                          errorText: _studentNoError,
                        ),
                        // Numara degisince "kullanimda" isareti kalksin
                        onChanged: (_) {
                          if (_studentNoError != null) setState(() => _studentNoError = null);
                        },
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.next,
                        validator: _validateStudentNo,
                      ),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      controller: _email,
                      decoration: const InputDecoration(
                          labelText: 'E-posta', prefixIcon: Icon(Icons.email)),
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      textInputAction: TextInputAction.next,
                      validator: _validateEmail,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _password,
                      obscureText: _hidePassword,
                      decoration: InputDecoration(
                        labelText: 'Şifre',
                        prefixIcon: const Icon(Icons.lock),
                        suffixIcon: IconButton(
                          icon: Icon(_hidePassword ? Icons.visibility : Icons.visibility_off),
                          onPressed: () => setState(() => _hidePassword = !_hidePassword),
                        ),
                      ),
                      textInputAction:
                          _isRegister ? TextInputAction.next : TextInputAction.done,
                      onFieldSubmitted: _isRegister ? null : (_) => _submit(),
                      validator: _validatePassword,
                    ),
                    if (_isRegister) ...[
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _passwordRepeat,
                        obscureText: _hidePassword,
                        decoration: const InputDecoration(
                            labelText: 'Şifre (tekrar)', prefixIcon: Icon(Icons.lock_outline)),
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _submit(),
                        validator: (v) => v != _password.text ? 'Şifreler aynı değil' : null,
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!,
                          style: TextStyle(color: Theme.of(context).colorScheme.error)),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: _busy
                            ? const SizedBox(
                                height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                            : Text(_isRegister ? 'Kayıt ol' : 'Giriş yap'),
                      ),
                    ),
                    if (!_isRegister)
                      TextButton(
                        onPressed: _busy ? null : _resetPassword,
                        child: const Text('Şifremi unuttum'),
                      ),
                    if (_isRegister) ...[
                      const SizedBox(height: 12),
                      Text(
                        'Kayıt olduğunuz telefon, yoklama için hesabınıza bağlanır. '
                        'Telefon değiştirirseniz öğretmeninize başvurmanız gerekir.',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                    // ML olcum gunu: arkadaslarin telefonlari hesap acmadan olcum yapabilsin
                    if (!_isRegister)
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => Navigator.of(context).push(MaterialPageRoute(
                                builder: (_) => const DataCollectionScreen())),
                        child: const Text('Veri toplama modu (geliştirici)'),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
