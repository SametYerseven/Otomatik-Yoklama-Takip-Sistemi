import 'package:flutter/material.dart';

import '../demo_data.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Istatistikler: genel devam, ders bazinda devam, kalan devamsizlik hakki,
/// son yoklamalar. Asama 3'e kadar veriler demo modundan gelir.
class StatsScreen extends StatelessWidget {
  const StatsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: DemoSettings.instance.enabled,
      builder: (context, demo, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('İstatistikler')),
          body: demo ? _content(context) : _empty(),
        );
      },
    );
  }

  Widget _empty() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: const [
        Card(
          child: EmptyHint(
            icon: Icons.insights_outlined,
            text: 'Yoklamaların sunucuya kaydedilmeye başladığında devam yüzdelerin ve '
                'devamsızlık hakların burada görünecek.',
          ),
        ),
      ],
    );
  }

  Widget _content(BuildContext context) {
    final now = DateTime.now();
    final stats = DemoData.stats(now);
    final records = DemoData.records(now);
    final held = stats.fold(0, (a, s) => a + s.held);
    final attended = stats.fold(0, (a, s) => a + s.attended);
    final overall = held == 0 ? 1.0 : attended / held;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        _OverallCard(ratio: overall, attended: attended, held: held, stats: stats),
        const SectionTitle('Ders bazında devam'),
        for (final s in stats) ...[
          _CourseCard(stats: s),
          const SizedBox(height: 10),
        ],
        const SectionTitle('Son yoklamalar'),
        Card(
          child: Column(
            children: [for (final r in records.take(8)) _RecordTile(record: r)],
          ),
        ),
      ],
    );
  }
}

class _OverallCard extends StatelessWidget {
  final double ratio;
  final int attended;
  final int held;
  final List<CourseStats> stats;
  const _OverallCard(
      {required this.ratio, required this.attended, required this.held, required this.stats});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.forAttendance(ratio);
    final risky = stats.where((s) => s.remainingAbsence <= 1).length;
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.65);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            RingChart(
              value: ratio,
              color: color,
              size: 116,
              center: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('%${(ratio * 100).round()}',
                      style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: color)),
                  Text('devam', style: TextStyle(color: muted, fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(width: 20),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Genel devam durumu',
                      style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
                  const SizedBox(height: 8),
                  Text('$held dersin $attended tanesine katıldın.', style: TextStyle(color: muted)),
                  const SizedBox(height: 4),
                  Text('Devam şartı: her derste en az %70', style: TextStyle(color: muted)),
                  const SizedBox(height: 10),
                  risky == 0
                      ? const StatusChip('Tüm derslerde güvendesin',
                          color: AppColors.success, icon: Icons.check_circle)
                      : StatusChip('$risky derste sınıra yakınsın',
                          color: AppColors.warning, icon: Icons.warning_amber_rounded),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CourseCard extends StatelessWidget {
  final CourseStats stats;
  const _CourseCard({required this.stats});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.forAttendance(stats.ratio);
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    final remaining = stats.remainingAbsence;
    final remainingColor = remaining == 0
        ? AppColors.red
        : remaining == 1
            ? AppColors.warning
            : AppColors.success;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(stats.lesson.name,
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      Text(stats.lesson.code, style: TextStyle(color: muted, fontSize: 12)),
                    ],
                  ),
                ),
                Text('%${(stats.ratio * 100).round()}',
                    style: TextStyle(color: color, fontWeight: FontWeight.w800, fontSize: 20)),
              ],
            ),
            const SizedBox(height: 10),
            ProgressBar(value: stats.ratio, color: color, threshold: 0.70),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('${stats.attended}/${stats.held} ders', style: TextStyle(color: muted)),
                const Spacer(),
                StatusChip(
                  remaining == 0
                      ? 'Devamsızlık hakkın bitti'
                      : '$remaining hafta devamsızlık hakkın var',
                  color: remainingColor,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RecordTile extends StatelessWidget {
  final AttendanceRecord record;
  const _RecordTile({required this.record});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
    final present = record.present;
    return ListTile(
      leading: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text('${record.date.day}',
              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          Text(TrDate.date(record.date).split(' ').last.substring(0, 3),
              style: TextStyle(color: muted, fontSize: 11)),
        ],
      ),
      title: Text(record.lesson.name, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(
          '${TrDate.duration(record.minutesInClass)} / ${TrDate.duration(record.lesson.durationMinutes)} · Sınıf ${record.lesson.room}'),
      trailing: StatusChip(present ? 'VAR' : 'YOK',
          color: present ? AppColors.success : AppColors.red),
    );
  }
}
