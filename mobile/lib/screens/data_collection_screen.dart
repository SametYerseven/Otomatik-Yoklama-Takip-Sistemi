import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../beacon_controller.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Olcum konumu: CSV'deki `location` ve `label` (1 = sinif ici, 0 = disi).
class _Place {
  final String id;
  final String title;
  final int label;
  const _Place(this.id, this.title, this.label);
}

// Adlar train.py ve CLAUDE.md'deki olcum planiyla ayni olmali (kucuk harf, _).
const _places = [
  _Place('front_row', 'Ön sıra', 1),
  _Place('middle_row', 'Orta sıra', 1),
  _Place('back_row', 'Arka sıra', 1),
  _Place('corner_front', 'Ön köşe', 1),
  _Place('corner_back', 'Arka köşe', 1),
  _Place('door_inside', 'Kapı yanı sıra', 1),
  _Place('walking_inside', 'Sınıfta yürüme', 1),
  _Place('door_outside', 'Kapının hemen önü', 0),
  _Place('corridor_5m', 'Koridor 5 m', 0),
  _Place('corridor_10m', 'Koridor 10 m', 0),
  _Place('corridor_20m', 'Koridor 20 m', 0),
  _Place('next_room', 'Yan sınıf', 0),
  _Place('upstairs', 'Üst kat', 0),
  _Place('downstairs', 'Alt kat', 0),
];
const _carries = {'hand': 'Elde', 'pocket': 'Cepte', 'bag': 'Çantada', 'desk': 'Masada'};
const _doors = {'': 'Belirtme', 'open': 'Kapı açık', 'closed': 'Kapı kapalı'};

/// ML veri toplama modu (CLAUDE.md "ML veri toplama plani"): secilen konum/etiket/tasima
/// bilgisiyle her ~1 sn'lik RSSI olcumunu telefonda CSV'ye yazar. Kayit native tarafta
/// (Android: RssiLogger.kt, iOS: AppDelegate.swift icindeki RssiLogger) surer; ekran
/// kapansa da devam eder. Dosyalar "Paylaş" ile bilgisayara alinip train.py'ye verilir.
class DataCollectionScreen extends StatefulWidget {
  /// Firebase olmadan (or. iOS'ta GoogleService-Info.plist yokken) uygulamanin tek ekrani.
  final bool standalone;
  const DataCollectionScreen({super.key, this.standalone = false});

  @override
  State<DataCollectionScreen> createState() => _DataCollectionScreenState();
}

class _DataCollectionScreenState extends State<DataCollectionScreen> {
  static const _channel = MethodChannel('attendance/rssi_logger');

  String _place = 'front_row';
  String _carry = 'hand';
  String _door = '';
  Map<String, dynamic> _status = {};
  List<Map<String, dynamic>> _files = [];
  String? _error;
  bool _busy = false;
  bool _unsupported = false;
  Timer? _timer;

  bool get _recording => _status['recording'] == true;
  _Place get _selected => _places.firstWhere((p) => p.id == _place);
  String get _location => _door.isEmpty ? _place : '${_place}_$_door';

  @override
  void initState() {
    super.initState();
    // Android: izinleri iste ve taramayi baslat (iOS'ta izni native taraf ister)
    if (Platform.isAndroid) BeaconController.instance.start();
    _refreshFiles();
    _refreshStatus();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _refreshStatus());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshStatus() async {
    try {
      final s = await _channel.invokeMethod<Map>('status');
      if (!mounted) return;
      setState(() => _status = Map<String, dynamic>.from(s ?? {}));
    } on MissingPluginException {
      _timer?.cancel();
      if (mounted) setState(() => _unsupported = true);
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = e.message ?? e.code);
    }
  }

  Future<void> _refreshFiles() async {
    try {
      final list = await _channel.invokeMethod<List>('files') ?? [];
      if (!mounted) return;
      // Platform kanalindan gelen liste sabit uzunlukta: kopyala
      setState(() => _files = list.map((e) => Map<String, dynamic>.from(e as Map)).toList());
    } on MissingPluginException {
      if (mounted) setState(() => _unsupported = true);
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = e.message ?? e.code);
    }
  }

  Future<void> _call(String method, [Map<String, dynamic>? args]) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _channel.invokeMethod(method, args);
    } on PlatformException catch (e) {
      if (mounted) setState(() => _error = e.message ?? e.code);
    } finally {
      await _refreshStatus();
      await _refreshFiles();
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start() =>
      _call('start', {'label': _selected.label, 'location': _location, 'carry': _carry});

  Future<void> _stop() => _call('stop');

  Future<void> _share(List<String> names) => _call('share', {'names': names});

  Future<void> _delete(String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Dosya silinsin mi?'),
        content: Text('$name\n\nPaylaşmadıysan bu ölçüm kaybolur.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Vazgeç')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Sil')),
        ],
      ),
    );
    if (ok == true) await _call('delete', {'name': name});
  }

  String _elapsed() {
    final started = _status['startedAt'];
    if (!_recording || started is! int || started == 0) return '00:00';
    final s = (DateTime.now().millisecondsSinceEpoch - started) ~/ 1000;
    return '${(s ~/ 60).toString().padLeft(2, '0')}:${(s % 60).toString().padLeft(2, '0')}';
  }

  String _lastHeard() {
    final rssi = _status['lastRssi'];
    final at = _status['lastAt'];
    if (rssi == null || at is! int || at == 0) return 'Henüz ölçüm yok';
    final ago = (DateTime.now().millisecondsSinceEpoch - at) ~/ 1000;
    return 'Son ölçüm: $rssi dBm ($ago sn önce)';
  }

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    return Scaffold(
      appBar: AppBar(title: const Text('Veri toplama')),
      body: _unsupported
          ? const EmptyHint(
              icon: Icons.block, text: 'Bu platformda veri toplama modu henüz yok.')
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              children: [
                if (widget.standalone)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      'Firebase ayarlanmadığı için uygulama sadece veri toplama modunda açıldı.',
                      style: TextStyle(color: muted),
                    ),
                  ),
                _statusCard(muted),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!,
                        style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ),
                const SectionTitle('Konum: sınıf içi'),
                _placeChips(1),
                const SectionTitle('Konum: sınıf dışı'),
                _placeChips(0),
                const SectionTitle('Kapı'),
                _chips(_doors, _door, (v) => setState(() => _door = v)),
                const SectionTitle('Telefon nerede?'),
                _chips(_carries, _carry, (v) => setState(() => _carry = v)),
                const SizedBox(height: 12),
                Text(
                  'Kaydedilecek: label=${_selected.label}, location=$_location, carry=$_carry',
                  style: TextStyle(color: muted, fontFamily: 'monospace', fontSize: 12),
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  style: _recording
                      ? FilledButton.styleFrom(backgroundColor: AppColors.red)
                      : null,
                  onPressed: _busy ? null : (_recording ? _stop : _start),
                  icon: Icon(_recording ? Icons.stop : Icons.fiber_manual_record),
                  label: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_recording ? 'Durdur' : 'Başlat'),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'Konumu ve telefonun yerini seç, Başlat\'a bas, o konumda en az 2–3 dakika '
                  'bekle, Durdur\'a bas. Kayıt sürerken ekran kapatılabilir, telefon cebe konabilir. '
                  'Konum değiştirmeden önce mutlaka Durdur.',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                SectionTitle('Kayıtlı dosyalar (${_files.length})',
                    trailing: TextButton(
                      onPressed: _busy || _files.isEmpty
                          ? null
                          : () => _share([for (final f in _files) f['name'] as String]),
                      child: const Text('Tümünü paylaş'),
                    )),
                Card(
                  child: _files.isEmpty
                      ? const EmptyHint(icon: Icons.folder_open, text: 'Henüz kayıt yok.')
                      : Column(
                          children: [
                            for (final f in _files)
                              ListTile(
                                dense: true,
                                title: Text(f['name'] as String,
                                    style: const TextStyle(fontSize: 12)),
                                subtitle: Text(
                                    '${(((f['size'] as num?) ?? 0) / 1024).toStringAsFixed(1)} KB'),
                                trailing: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Paylaş',
                                      icon: const Icon(Icons.share),
                                      onPressed: _busy ? null : () => _share([f['name'] as String]),
                                    ),
                                    IconButton(
                                      tooltip: 'Sil',
                                      icon: const Icon(Icons.delete_outline),
                                      onPressed: _busy || (_recording && _status['file'] == f['name'])
                                          ? null
                                          : () => _delete(f['name'] as String),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                ),
              ],
            ),
    );
  }

  Widget _statusCard(Color muted) {
    return Card(
      margin: const EdgeInsets.only(top: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                StatusChip(
                  _recording ? 'Kayıt sürüyor' : 'Kayıt yok',
                  color: _recording ? AppColors.success : AppColors.warning,
                  icon: _recording ? Icons.fiber_manual_record : Icons.pause,
                ),
                const Spacer(),
                Text(_elapsed(),
                    style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 10),
            if (_recording) ...[
              Text('${_status['location']} · ${_status['carry']} · label ${_status['label']}',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text('${_status['rows'] ?? 0} satır', style: TextStyle(color: muted)),
            ],
            Text(_lastHeard(), style: TextStyle(color: muted)),
          ],
        ),
      ),
    );
  }

  Widget _placeChips(int label) {
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final p in _places.where((p) => p.label == label))
          ChoiceChip(
            label: Text(p.title),
            selected: _place == p.id,
            onSelected: _recording ? null : (_) => setState(() => _place = p.id),
          ),
      ],
    );
  }

  Widget _chips(Map<String, String> options, String value, ValueChanged<String> onChanged) {
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: [
        for (final e in options.entries)
          ChoiceChip(
            label: Text(e.value),
            selected: value == e.key,
            onSelected: _recording ? null : (_) => onChanged(e.key),
          ),
      ],
    );
  }
}
