import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xterm/xterm.dart';

// Flutter-side mapping of packages/theme/src/tokens/compat-shadcn.css.
const Color tetherLightBackground = Color(0xFFF4F5F7);
const Color tetherLightForeground = Color(0xFF0F1115);
const Color tetherLightCard = Color(0xFFFFFFFF);
const Color tetherLightBrand = Color(0xFF00B974);
const Color tetherLightBrandHover = Color(0xFF009A61);
const Color tetherLightBrandText = Color(0xFF00875A);
const Color tetherLightBrandMuted = Color(0x1A00B974);
const Color tetherLightBorder = Color(0xFFE5E7EB);
const Color tetherLightInput = Color(0x1F000000);
const Color tetherLightMuted = Color(0xFF4B5563);
const Color tetherLightDestructive = Color(0xFFE0264F);
const Color tetherLightSuccess = Color(0xFF16A268);
const Color tetherLightCanvas = Color(0xFFFFFFFF);
const Color tetherLightSurface = Color(0xFFFFFFFF);
const Color tetherLightField = Color(0x0A000000);

const Color tetherDarkBackground = Color(0xFF050505);
const Color tetherDarkForeground = Color(0xFFFFFFFF);
const Color tetherDarkCard = Color(0xFF111113);
const Color tetherDarkBrand = tetherLightBrand;
const Color tetherDarkBrandHover = tetherLightBrandHover;
const Color tetherDarkBrandText = tetherLightBrand;
const Color tetherDarkBrandMuted = tetherLightBrandMuted;
const Color tetherDarkBorder = Color(0xFF27272A);
const Color tetherDarkInput = Color(0xFF2E2E32);
const Color tetherDarkMuted = Color(0xFFA1A1AA);
const Color tetherDarkDestructive = Color(0xFFFF3366);
const Color tetherDarkSuccess = Color(0xFF2EE08A);
const Color tetherDarkCanvas = Color(0xFF000000);
const Color tetherDarkSurface = Color(0xFF111113);
const Color tetherDarkField = Color(0xFF0F0F11);

const Color tetherPrimaryForeground = Color(0xFF000000);
const Color tetherDestructiveForeground = Color(0xFFFFFFFF);
const Color tetherCardShadow = Color(0x2E000000);
const Color tetherTransparent = Color(0x00000000);

const List<Color> tetherAuthLightGradient = [
  Color(0xFFF4F5F7),
  Color(0xFFFFFFFF),
  Color(0xFFF8FAFC),
];
const List<Color> tetherAuthDarkGradient = [
  Color(0xFF000000),
  Color(0xFF111113),
  Color(0xFF050505),
];

// Backward-compatible aliases for existing Flutter code. New code should prefer
// Theme.of(context).colorScheme or the explicit light/dark token constants above.
const Color tetherBackground = tetherDarkBackground;
const Color tetherSurface = tetherDarkSurface;
const Color tetherBorder = tetherDarkBorder;
const Color tetherInputBorder = tetherDarkInput;
const Color tetherAccent = tetherDarkBrand;
const Color tetherForeground = tetherDarkForeground;
const Color tetherMuted = tetherDarkMuted;
const Color tetherDestructive = tetherDarkDestructive;
const Color tetherSuccess = tetherDarkSuccess;

const String kThemePrefKey = 'tether:theme';
const String kLocalePrefKey = 'tether:locale';

ThemeData buildTetherThemeData(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final background = isDark ? tetherDarkBackground : tetherLightBackground;
  final foreground = isDark ? tetherDarkForeground : tetherLightForeground;
  final card = isDark ? tetherDarkCard : tetherLightCard;
  final brand = isDark ? tetherDarkBrand : tetherLightBrand;
  final success = isDark ? tetherDarkSuccess : tetherLightSuccess;
  final destructive =
      isDark ? tetherDarkDestructive : tetherLightDestructive;
  final border = isDark ? tetherDarkBorder : tetherLightBorder;
  final input = isDark ? tetherDarkInput : tetherLightInput;
  final muted = isDark ? tetherDarkMuted : tetherLightMuted;
  final brandMuted = isDark ? tetherDarkBrandMuted : tetherLightBrandMuted;
  final colorScheme = ColorScheme(
    brightness: brightness,
    primary: brand,
    onPrimary: tetherPrimaryForeground,
    secondary: success,
    onSecondary: tetherPrimaryForeground,
    error: destructive,
    onError: tetherDestructiveForeground,
    surface: card,
    onSurface: foreground,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: background,
    cardTheme: CardThemeData(
      color: card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: border),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? tetherDarkField : tetherLightField,
      labelStyle: TextStyle(color: muted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: input),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: input),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: brand, width: 1.5),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        backgroundColor: brand,
        foregroundColor: tetherPrimaryForeground,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: isDark ? tetherDarkBrandText : tetherLightBrandText,
        textStyle: const TextStyle(fontWeight: FontWeight.w700),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: foreground,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: card,
      indicatorColor: brand,
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(color: tetherPrimaryForeground);
        }
        return IconThemeData(color: muted);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          color: selected ? foreground : muted,
          fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
        );
      }),
    ),
    tabBarTheme: TabBarThemeData(
      dividerColor: tetherTransparent,
      indicatorColor: brand,
      labelColor: tetherPrimaryForeground,
      unselectedLabelColor: muted,
      labelStyle: const TextStyle(fontWeight: FontWeight.w800),
      unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: brandMuted,
      selectedColor: brand,
      labelStyle: TextStyle(color: isDark ? tetherDarkBrandText : tetherLightBrandText),
      side: BorderSide(color: brandMuted),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  );
}

final TerminalTheme tetherTerminalTheme = TerminalTheme(
  cursor: tetherDarkBrand,
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
