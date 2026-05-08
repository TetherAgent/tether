import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'router.dart';
import 'services/auth_service.dart';

const _keyLocale = 'tether:locale';
const _keyTheme = 'tether:theme';

class TetherApp extends StatefulWidget {
  const TetherApp({super.key});

  @override
  State<TetherApp> createState() => _TetherAppState();
}

class _TetherAppState extends State<TetherApp> {
  late final AuthService _auth;
  late GoRouter _router;
  ThemeMode _themeMode = ThemeMode.system;
  Locale _locale = const Locale('zh');
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _auth = AuthService();
    _init();
  }

  Future<void> _init() async {
    await _auth.load();
    final prefs = await SharedPreferences.getInstance();
    final localeCode = prefs.getString(_keyLocale);
    if (localeCode == 'en') _locale = const Locale('en');
    final theme = prefs.getString(_keyTheme);
    if (theme == 'dark') _themeMode = ThemeMode.dark;
    if (theme == 'light') _themeMode = ThemeMode.light;
    _router = buildRouter(_auth);
    setState(() => _ready = true);
  }

  void setLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyLocale, locale.languageCode);
    setState(() => _locale = locale);
  }

  void setThemeMode(ThemeMode mode) async {
    final prefs = await SharedPreferences.getInstance();
    final value = mode == ThemeMode.dark
        ? 'dark'
        : mode == ThemeMode.light
            ? 'light'
            : 'system';
    await prefs.setString(_keyTheme, value);
    setState(() => _themeMode = mode);
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return const MaterialApp(
        home: Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    return MultiProvider(
      providers: [
        Provider<AuthService>.value(value: _auth),
        Provider<Function(Locale)>.value(value: setLocale),
        Provider<Function(ThemeMode)>.value(value: setThemeMode),
      ],
      child: MaterialApp.router(
        title: 'Tether',
        themeMode: _themeMode,
        theme: _buildTheme(Brightness.light),
        darkTheme: _buildTheme(Brightness.dark),
        locale: _locale,
        supportedLocales: const [Locale('zh'), Locale('en')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        routerConfig: _router,
      ),
    );
  }

  ThemeData _buildTheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF00B96B), // brand green
        brightness: brightness,
      ),
      scaffoldBackgroundColor: isDark ? const Color(0xFF0E0E0E) : const Color(0xFFF9F9F9),
      fontFamily: 'system-ui',
    );
  }
}
