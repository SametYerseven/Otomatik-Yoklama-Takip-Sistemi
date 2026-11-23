import 'dart:async';

import 'package:flutter/material.dart';

import '../beacon_controller.dart';
import '../demo_data.dart';
import '../student_service.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Ana Sayfa: anlik sinif durumu, sonraki ders, bugunku dersler, son giris/cikislar.
class HomeScreen extends StatefulWidget {
  final StudentProfile profile;
  const HomeScreen({super.key, required this.profile});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    // Sinifta gecen sure ve geri sayim guncel kalsin
    _ticker = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final beacon = BeaconController.instance;
    final demo = DemoSettings.instance;
    return ListenableBuilder(
      listenable: Listenable.merge([beacon, demo.enabled, demo.simulateInClass]),
      builder: (context, _) {
        final now = DateTime.now();
        final firstName = widget.profile.name.split(' ').first;
        return Scaffold(
          body: SafeArea(
            child: RefreshIndicator(
              onRefresh: beacon.loadHistory,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                children: [
                  _Header(name: firstName, now: now),
                  const SizedBox(height: 16),
                  _StatusCard(now: now),
                  const SectionTitle('Sonraki ders'),
                  _NextLessonCard(now: now),
                  if (demo.enabled.value) ...[
                    SectionTitle('Bugünkü dersler', trailing: Text(TrDate.day(now))),
                    _TodayCard(now: now),
                  ],
                  const SectionTitle('Son giriş / çıkışlar'),
                  _HistoryCard(lines: _historyLines(beacon, demo.enabled.value)),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  List<String> _historyLines(BeaconController beacon, bool demo) {
    if (beacon.history.isNotEmpty || !demo) return beacon.history.take(5).toList();
    return const ['09:02:41  Sınıfa girdin', '11:48:10  Sınıftan çıktın', '13:01:05  Sınıfa girdin'];
  }
}

class _Header extends StatelessWidget {
  final String name;
  final DateTime now;
  const _Header({required this.name, required this.now});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(TrDate.dateLong(now), style: TextStyle(color: muted, fontSize: 14)),
              const SizedBox(height: 2),
              Text('Merhaba, $name',
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w800)),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
          child: Image.asset('assets/images/cbu_emblem.png', height: 34),
        ),
      ],
    );
  }
}

/// Buyuk durum karti. Gercek veri: beacon'dan gelen giris/cikis.
/// Demo modunda ders adi ve (istenirse) "sinifta" durumu ornek programdan gelir.
class _StatusCard extends StatelessWidget {
  final DateTime now;
  const _StatusCard({required this.now});

  @override
  Widget build(BuildContext context) {
    final beacon = BeaconController.instance;
    final demo = DemoSettings.instance;

    int? room = beacon.currentRoom;
    DateTime? since = beacon.enteredAt;
    Lesson? lesson;
    var inClass = beacon.inClass;

    if (demo.enabled.value) {
      if (room != null) lesson = DemoData.lessonInRoom(room, now);
      if (!inClass && demo.simulateInClass.value) {
        lesson = DemoData.current(now) ?? DemoData.lessons.first;
        room = lesson.room;
        final start = lesson.startOn(now);
        since = now.isAfter(start) && now.isBefore(lesson.endOn(now))
            ? start.add(const Duration(minutes: 2))
            : now.subtract(const Duration(minutes: 42));
        inClass = true;
      }
    }

    if (!inClass) return _NotInClass(beacon: beacon);

    final minutes = since == null ? 0 : now.difference(since).inMinutes;
    final progress = lesson == null ? null : minutes / lesson.durationMinutes;
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.sensors, color: Colors.white, size: 16),
                  SizedBox(width: 6),
                  Text('Sınıftasın',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                ]),
              ),
              const Spacer(),
              Text('Sınıf ${room ?? '-'}',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 18),
          Text(lesson?.title ?? 'Ders bilgisi bekleniyor',
              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
          if (lesson != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(lesson.teacher,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
            ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(TrDate.duration(minutes),
                  style: const TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800)),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('sınıfta',
                    style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
              ),
              const Spacer(),
              if (since != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Text('Giriş ${TrDate.time(since)}',
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.8))),
                ),
            ],
          ),
          if (progress != null) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: LinearProgressIndicator(
                value: progress.clamp(0, 1),
                minHeight: 8,
                backgroundColor: Colors.white.withValues(alpha: 0.2),
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text('Dersin %${(progress.clamp(0, 1) * 100).round()} kadarında sınıftasın',
                style: TextStyle(color: Colors.white.withValues(alpha: 0.85), fontSize: 13)),
          ],
        ],
      ),
    );
  }
}

class _NotInClass extends StatelessWidget {
  final BeaconController beacon;
  const _NotInClass({required this.beacon});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final scanning = beacon.isScanning;
    final color = beacon.problem != null ? AppColors.warning : scheme.primary;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(
                beacon.problem != null ? Icons.bluetooth_disabled : Icons.bluetooth_searching,
                color: color,
                size: 30,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Şu an sınıfta değilsin',
                      style: Theme.of(context)
                          .textTheme
                          .titleMedium
                          ?.copyWith(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 4),
                  Text(
                    beacon.problem ??
                        (scanning
                            ? 'Sınıfa girdiğinde yoklaman otomatik alınır. Telefonunu çıkarmana gerek yok.'
                            : 'Tarama başlatılıyor...'),
                    style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.65)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NextLessonCard extends StatelessWidget {
  final DateTime now;
  const _NextLessonCard({required this.now});

  @override
  Widget build(BuildContext context) {
    if (!DemoSettings.instance.enabled.value) {
      return const Card(
        child: EmptyHint(
          icon: Icons.event_note_outlined,
          text: 'Ders programın henüz tanımlı değil. Dersler eklendiğinde bir sonraki dersin burada görünecek.',
        ),
      );
    }
    final next = DemoData.next(now);
    if (next == null) {
      return const Card(child: EmptyHint(icon: Icons.event_available, text: 'Bu hafta başka ders yok.'));
    }
    final (lesson, start) = next;
    final left = start.difference(now).inMinutes;
    final scheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 64,
              padding: const EdgeInsets.symmetric(vertical: 10),
              decoration: BoxDecoration(
                color: scheme.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                children: [
                  Text(TrDate.time(start),
                      style: TextStyle(
                          color: scheme.primary, fontWeight: FontWeight.w800, fontSize: 16)),
                  const SizedBox(height: 2),
                  Text(TrDate.relativeDay(start, now).split(' ').first,
                      style: TextStyle(color: scheme.primary, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(lesson.title,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(height: 4),
                  Text('${TrDate.relativeDay(start, now)} · Sınıf ${lesson.room}',
                      style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.65))),
                  Text(lesson.teacher,
                      style: TextStyle(color: scheme.onSurface.withValues(alpha: 0.65))),
                ],
              ),
            ),
            StatusChip(
              left < 60 * 24 ? '${TrDate.duration(left)} sonra' : TrDate.date(start),
              color: AppColors.sky,
              icon: Icons.schedule,
            ),
          ],
        ),
      ),
    );
  }
}

class _TodayCard extends StatelessWidget {
  final DateTime now;
  const _TodayCard({required this.now});

  @override
  Widget build(BuildContext context) {
    final lessons = DemoData.today(now);
    if (lessons.isEmpty) {
      return const Card(child: EmptyHint(icon: Icons.weekend_outlined, text: 'Bugün dersin yok.'));
    }
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    return Card(
      child: Column(
        children: [
          for (final l in lessons)
            ListTile(
              leading: Text(
                '${TrDate.time(l.startOn(now))}\n${TrDate.time(l.endOn(now))}',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted, fontSize: 12, height: 1.4),
              ),
              title: Text(l.title, style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text('Sınıf ${l.room} · ${l.teacher}'),
              trailing: _lessonState(l),
            ),
        ],
      ),
    );
  }

  Widget _lessonState(Lesson l) {
    if (now.isAfter(l.endOn(now))) return const StatusChip('Bitti', color: Colors.grey);
    if (now.isAfter(l.startOn(now))) {
      return const StatusChip('Şimdi', color: AppColors.success, icon: Icons.circle);
    }
    return const StatusChip('Sırada', color: AppColors.sky);
  }
}

class _HistoryCard extends StatelessWidget {
  final List<String> lines;
  const _HistoryCard({required this.lines});

  @override
  Widget build(BuildContext context) {
    if (lines.isEmpty) {
      return const Card(
        child: EmptyHint(icon: Icons.history, text: 'Henüz giriş/çıkış kaydı yok.'),
      );
    }
    return Card(
      child: Column(
        children: [
          for (final line in lines) _row(context, line),
        ],
      ),
    );
  }

  Widget _row(BuildContext context, String line) {
    final entered = line.contains('girdin');
    final time = line.split(' ').first;
    final text = line.substring(time.length).trim();
    final color = entered ? AppColors.success : AppColors.warning;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: color.withValues(alpha: 0.12),
        child: Icon(entered ? Icons.login : Icons.logout, color: color, size: 20),
      ),
      title: Text(text, style: const TextStyle(fontWeight: FontWeight.w600)),
      trailing: Text(time.length >= 5 ? time.substring(0, 5) : time,
          style: TextStyle(color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6))),
    );
  }
}
