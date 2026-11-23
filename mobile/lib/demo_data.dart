import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Haftalik ders programindaki bir ders.
class Lesson {
  final String code;
  final String name;
  final String teacher;
  final int room; // beacon major degeriyle ayni (sinif numarasi)
  final int weekday; // DateTime.monday (1) ... DateTime.sunday (7)
  final int startHour;
  final int startMinute;
  final int durationMinutes;

  const Lesson({
    required this.code,
    required this.name,
    required this.teacher,
    required this.room,
    required this.weekday,
    required this.startHour,
    required this.startMinute,
    required this.durationMinutes,
  });

  String get title => '$code - $name';

  DateTime startOn(DateTime day) =>
      DateTime(day.year, day.month, day.day, startHour, startMinute);

  DateTime endOn(DateTime day) => startOn(day).add(Duration(minutes: durationMinutes));
}

/// Bir dersin bir haftadaki yoklama sonucu.
class AttendanceRecord {
  final Lesson lesson;
  final DateTime date;
  final int minutesInClass;
  const AttendanceRecord(this.lesson, this.date, this.minutesInClass);

  double get ratio => minutesInClass / lesson.durationMinutes;

  /// Web panelindeki kuralla ayni: derste %70'ten fazla kalan "VAR" sayilir.
  bool get present => ratio >= 0.70;
}

/// Bir dersin donem ici devam ozeti.
class CourseStats {
  final Lesson lesson;
  final int held; // simdiye kadar yapilan ders sayisi
  final int attended;
  const CourseStats(this.lesson, this.held, this.attended);

  static const semesterWeeks = 14;
  static const maxAbsence = 4; // 14 haftanin %30'u (asagi yuvarlanmis)

  int get absent => held - attended;
  double get ratio => held == 0 ? 1 : attended / held;
  int get remainingAbsence => (maxAbsence - absent).clamp(0, maxAbsence);
}

/// Demo modu ayarlari. Gelistirici ekranindan acilip kapatilir, telefonda saklanir.
class DemoSettings {
  DemoSettings._();
  static final instance = DemoSettings._();

  static const _keyEnabled = 'demo_enabled';
  static const _keyInClass = 'demo_in_class';

  /// Ders programi, istatistik ve gecmis icin ornek veri gosterilsin mi?
  final enabled = ValueNotifier<bool>(false);

  /// Ekran goruntusu icin: beacon gorulmese de "sinifta" durumu gosterilsin mi?
  final simulateInClass = ValueNotifier<bool>(false);

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    enabled.value = prefs.getBool(_keyEnabled) ?? false;
    simulateInClass.value = prefs.getBool(_keyInClass) ?? false;
  }

  Future<void> setEnabled(bool value) async {
    enabled.value = value;
    if (!value) simulateInClass.value = false;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyEnabled, value);
    await prefs.setBool(_keyInClass, simulateInClass.value);
  }

  Future<void> setSimulateInClass(bool value) async {
    simulateInClass.value = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyInClass, value);
  }
}

/// Ornek ders programi ve yoklama gecmisi. Asama 3'te gercek veriyle degisecek.
class DemoData {
  static const lessons = <Lesson>[
    Lesson(code: 'SE 3114', name: 'Nesnelerin İnterneti', teacher: 'Doç. Dr. Osman Altay',
        room: 203, weekday: DateTime.monday, startHour: 9, startMinute: 0, durationMinutes: 170),
    Lesson(code: 'SE 3924', name: 'Python Programlama', teacher: 'Doç. Dr. Osman Altay',
        room: 205, weekday: DateTime.monday, startHour: 13, startMinute: 0, durationMinutes: 110),
    Lesson(code: 'SE 3242', name: 'Servis Odaklı Mimari', teacher: 'Doç. Dr. Müge Özçevik',
        room: 204, weekday: DateTime.tuesday, startHour: 10, startMinute: 0, durationMinutes: 110),
    Lesson(code: 'SE 4523', name: 'Veri Madenciliği', teacher: 'Doç. Dr. Osman Altay',
        room: 203, weekday: DateTime.wednesday, startHour: 13, startMinute: 0, durationMinutes: 170),
    Lesson(code: 'SE 4101', name: 'Siber Güvenlik', teacher: 'Doç. Dr. Osman Altay',
        room: 206, weekday: DateTime.thursday, startHour: 9, startMinute: 0, durationMinutes: 110),
    Lesson(code: 'SE 2146', name: 'Yapay Zeka', teacher: 'Doç. Dr. Elif Varol Altay',
        room: 204, weekday: DateTime.friday, startHour: 14, startMinute: 0, durationMinutes: 110),
  ];

  /// Donem baslangici (pazartesi).
  static final semesterStart = DateTime(2026, 9, 21);

  /// Hangi haftalarda (0'dan baslayarak) derse gelinmedigi ya da erken ayrildigi.
  static const _missedWeeks = <String, List<int>>{
    'SE 3114': [3],
    'SE 3924': [2, 6],
    'SE 3242': [],
    'SE 4523': [1, 4, 7],
    'SE 4101': [5],
    'SE 2146': [0, 3],
  };

  /// Bitmis derslerin yoklama kayitlari (en yeni basta).
  static List<AttendanceRecord> records(DateTime now) {
    final result = <AttendanceRecord>[];
    for (final lesson in lessons) {
      for (var week = 0; week < CourseStats.semesterWeeks; week++) {
        final day = semesterStart.add(Duration(days: week * 7 + lesson.weekday - 1));
        if (!lesson.endOn(day).isBefore(now)) break;
        final missed = _missedWeeks[lesson.code]!.contains(week);
        // Tekrarlanabilir "rastgele" sure: her calistirmada ayni sonuc
        final seed = (week * 31 + lesson.code.codeUnits.fold<int>(0, (a, b) => a + b)) % 17;
        final int minutes = missed
            ? (week.isEven ? 0 : (lesson.durationMinutes * 0.4).round())
            : lesson.durationMinutes - seed;
        result.add(AttendanceRecord(lesson, lesson.startOn(day), minutes));
      }
    }
    result.sort((a, b) => b.date.compareTo(a.date));
    return result;
  }

  static List<CourseStats> stats(DateTime now) {
    final all = records(now);
    return lessons.map((lesson) {
      final mine = all.where((r) => r.lesson.code == lesson.code);
      return CourseStats(lesson, mine.length, mine.where((r) => r.present).length);
    }).toList();
  }

  static List<Lesson> today(DateTime now) =>
      lessons.where((l) => l.weekday == now.weekday).toList()
        ..sort((a, b) => a.startOn(now).compareTo(b.startOn(now)));

  /// Su an devam eden ders (yoksa null).
  static Lesson? current(DateTime now) {
    for (final l in today(now)) {
      if (!now.isBefore(l.startOn(now)) && now.isBefore(l.endOn(now))) return l;
    }
    return null;
  }

  /// Simdiden sonraki ilk ders ve tarihi.
  static (Lesson, DateTime)? next(DateTime now) {
    for (var offset = 0; offset < 8; offset++) {
      final day = DateTime(now.year, now.month, now.day).add(Duration(days: offset));
      final candidates = lessons.where((l) => l.weekday == day.weekday).toList()
        ..sort((a, b) => a.startOn(day).compareTo(b.startOn(day)));
      for (final l in candidates) {
        if (l.startOn(day).isAfter(now)) return (l, l.startOn(day));
      }
    }
    return null;
  }

  /// Sinif numarasina gore bugunku dersi bulur (gercek beacon + demo program).
  static Lesson? lessonInRoom(int room, DateTime now) {
    final cur = current(now);
    if (cur != null && cur.room == room) return cur;
    return null;
  }
}

/// Turkce tarih/saat yazimi (intl paketi eklememek icin elle).
class TrDate {
  static const _days = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  static const _months = [
    'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
    'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
  ];

  static String day(DateTime d) => _days[d.weekday - 1];
  static String time(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  static String date(DateTime d) => '${d.day} ${_months[d.month - 1]}';
  static String dateLong(DateTime d) => '${d.day} ${_months[d.month - 1]} ${day(d)}';

  /// "Bugün", "Yarın" ya da "24 Kasım Salı"
  static String relativeDay(DateTime d, DateTime now) {
    final a = DateTime(d.year, d.month, d.day);
    final b = DateTime(now.year, now.month, now.day);
    final diff = a.difference(b).inDays;
    if (diff == 0) return 'Bugün';
    if (diff == 1) return 'Yarın';
    return dateLong(d);
  }

  static String duration(int minutes) {
    final h = minutes ~/ 60;
    final m = minutes % 60;
    if (h == 0) return '$m dk';
    if (m == 0) return '$h sa';
    return '$h sa $m dk';
  }
}
