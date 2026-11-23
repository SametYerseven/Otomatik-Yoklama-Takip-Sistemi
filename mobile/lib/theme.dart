import 'package:flutter/material.dart';

/// Renkler Manisa Celal Bayar Universitesi logosundan alindi.
/// Degistirmek icin sadece bu sinifi duzenlemek yeterli.
class AppColors {
  static const navy = Color(0xFF284090); // logodaki lacivert (ana renk)
  static const sky = Color(0xFF0090D0); // logodaki acik mavi (vurgu)
  static const red = Color(0xFFD02030); // logodaki kirmizi (uyari)
  static const success = Color(0xFF1E9E6A); // "sinifta" / "var"
  static const warning = Color(0xFFE08A00); // devamsizlik sinirina yakin

  /// Devam yuzdesine gore renk: %70 alti kirmizi, %80 alti turuncu, ustu yesil.
  static Color forAttendance(double ratio) {
    if (ratio < 0.70) return red;
    if (ratio < 0.80) return warning;
    return success;
  }
}

class AppTheme {
  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.navy,
      brightness: brightness,
      // Acik temada ana renk tam olarak logodaki lacivert olsun
      primary: isDark ? const Color(0xFFB4C5FF) : AppColors.navy,
      secondary: AppColors.sky,
      error: AppColors.red,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark ? const Color(0xFF10131A) : const Color(0xFFF4F6FB),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: isDark ? const Color(0xFF10131A) : const Color(0xFFF4F6FB),
        foregroundColor: scheme.onSurface,
        titleTextStyle: TextStyle(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: scheme.onSurface,
        ),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: isDark ? const Color(0xFF1A1F2B) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: isDark ? const Color(0xFF262C3A) : const Color(0xFFE3E7F0)),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? const Color(0xFF161A24) : Colors.white,
        indicatorColor: scheme.primary.withValues(alpha: isDark ? 0.25 : 0.12),
        labelTextStyle: WidgetStateProperty.all(
          const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? const Color(0xFF1A1F2B) : Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: isDark ? const Color(0xFF2E3546) : const Color(0xFFD9DEEA)),
        ),
      ),
    );
  }
}
