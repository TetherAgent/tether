import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xterm/xterm.dart';

const Color tetherBackground = Color(0xFF0C0E10);
const Color tetherSurface = Color(0xFF171A1F);
const Color tetherBorder = Color(0xFF2B3137);
const Color tetherInputBorder = Color(0xFF3A424B);
const Color tetherAccent = Color(0xFF8FD0FF);
const Color tetherForeground = Color(0xFFE8ECEF);
const Color tetherMuted = Color(0xFF9AA4AF);
const Color tetherDestructive = Color(0xFFE05252);
const Color tetherSuccess = Color(0xFF42B883);

const String kThemePrefKey = 'tether:theme';
const String kLocalePrefKey = 'tether:locale';

ThemeData buildTetherThemeData(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final colorScheme = ColorScheme(
    brightness: brightness,
    primary: tetherAccent,
    onPrimary: tetherBackground,
    secondary: tetherSuccess,
    onSecondary: tetherBackground,
    error: tetherDestructive,
    onError: Colors.white,
    surface: isDark ? tetherSurface : Colors.white,
    onSurface: isDark ? tetherForeground : const Color(0xFF101418),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor:
        isDark ? tetherBackground : const Color(0xFFF5F7FA),
    cardTheme: CardThemeData(
      color: isDark ? tetherSurface : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
          color: isDark ? tetherBorder : const Color(0xFFD8DFE6),
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: tetherInputBorder),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: tetherInputBorder),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: tetherAccent, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        backgroundColor: tetherAccent,
        foregroundColor: tetherBackground,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
  );
}

final TerminalTheme tetherTerminalTheme = TerminalTheme(
  cursor: tetherAccent,
  selection: const Color(0x663C6E91),
  foreground: tetherForeground,
  background: tetherBackground,
  black: const Color(0xFF1E2328),
  red: const Color(0xFFE06C75),
  green: const Color(0xFF98C379),
  yellow: const Color(0xFFE5C07B),
  blue: const Color(0xFF61AFEF),
  magenta: const Color(0xFFC678DD),
  cyan: const Color(0xFF56B6C2),
  white: const Color(0xFFD7DAE0),
  brightBlack: const Color(0xFF5C6370),
  brightRed: const Color(0xFFBE5046),
  brightGreen: const Color(0xFF8EC07C),
  brightYellow: const Color(0xFFD19A66),
  brightBlue: const Color(0xFF61AFEF),
  brightMagenta: const Color(0xFFD3869B),
  brightCyan: const Color(0xFF56B6C2),
  brightWhite: const Color(0xFFFFFFFF),
  searchHitBackground: const Color(0xFF3C6E91),
  searchHitBackgroundCurrent: const Color(0xFF5B89AA),
  searchHitForeground: tetherForeground,
);

class ThemeNotifier extends ChangeNotifier {
  ThemeMode _themeMode = ThemeMode.system;

  ThemeMode get themeMode => _themeMode;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(kThemePrefKey);
    _themeMode = switch (stored) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    final prefs = await SharedPreferences.getInstance();
    final value = switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    };
    await prefs.setString(kThemePrefKey, value);
    notifyListeners();
  }

  Future<void> toggleTheme() async {
    await setThemeMode(
      _themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark,
    );
  }
}

class LocaleNotifier extends ChangeNotifier {
  Locale _locale = const Locale('zh');

  Locale get locale => _locale;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(kLocalePrefKey);
    _locale = stored == 'en' ? const Locale('en') : const Locale('zh');
    notifyListeners();
  }

  Future<void> setLocale(Locale locale) async {
    _locale = locale;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(kLocalePrefKey, locale.languageCode);
    notifyListeners();
  }

  Future<void> toggleLocale() async {
    await setLocale(
      _locale.languageCode == 'zh' ? const Locale('en') : const Locale('zh'),
    );
  }
}
