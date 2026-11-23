import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Kart ustundeki kucuk bolum basligi.
class SectionTitle extends StatelessWidget {
  final String text;
  final Widget? trailing;
  const SectionTitle(this.text, {super.key, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 10),
      child: Row(
        children: [
          Expanded(
            child: Text(text,
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.w700)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// Yuzde gosteren halka grafik (grafik paketi kullanmadan, CustomPainter ile).
class RingChart extends StatelessWidget {
  final double value; // 0..1
  final Color color;
  final double size;
  final double stroke;
  final Widget? center;

  const RingChart({
    super.key,
    required this.value,
    required this.color,
    this.size = 120,
    this.stroke = 12,
    this.center,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(
          value.clamp(0, 1),
          color,
          Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.08),
          stroke,
        ),
        child: Center(child: center),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  final double value;
  final Color color;
  final Color track;
  final double stroke;
  _RingPainter(this.value, this.color, this.track, this.stroke);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset(stroke / 2, stroke / 2) &
        Size(size.width - stroke, size.height - stroke);
    final base = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, 0, math.pi * 2, false, base..color = track);
    canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * value, false, base..color = color);
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.value != value || old.color != color || old.track != track;
}

/// Yatay ilerleme cubugu; istege bagli bir esik cizgisi (or. %70) gosterir.
class ProgressBar extends StatelessWidget {
  final double value; // 0..1
  final Color color;
  final double? threshold;
  final double height;

  const ProgressBar({
    super.key,
    required this.value,
    required this.color,
    this.threshold,
    this.height = 10,
  });

  @override
  Widget build(BuildContext context) {
    final track = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.08);
    return LayoutBuilder(builder: (context, c) {
      return SizedBox(
        height: height + 6,
        child: Stack(
          alignment: Alignment.centerLeft,
          children: [
            Container(
              height: height,
              decoration: BoxDecoration(color: track, borderRadius: BorderRadius.circular(height)),
            ),
            Container(
              height: height,
              width: c.maxWidth * value.clamp(0, 1),
              decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(height)),
            ),
            if (threshold != null)
              Positioned(
                left: c.maxWidth * threshold! - 1,
                child: Container(
                  width: 2,
                  height: height + 6,
                  color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.45),
                ),
              ),
          ],
        ),
      );
    });
  }
}

/// Renkli kucuk etiket (or. "VAR", "YOK", "Sınıfta").
class StatusChip extends StatelessWidget {
  final String text;
  final Color color;
  final IconData? icon;
  const StatusChip(this.text, {super.key, required this.color, this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 14, color: color),
            const SizedBox(width: 4),
          ],
          Text(text,
              style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

/// Bos durum mesaji (ikon + aciklama).
class EmptyHint extends StatelessWidget {
  final IconData icon;
  final String text;
  const EmptyHint({super.key, required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    final muted = Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.55);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
      child: Row(
        children: [
          Icon(icon, color: muted),
          const SizedBox(width: 12),
          Expanded(child: Text(text, style: TextStyle(color: muted))),
        ],
      ),
    );
  }
}
