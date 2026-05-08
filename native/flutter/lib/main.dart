import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';

import 'app_shell.dart';
import 'screens/login_screen.dart';
import 'screens/replay_screen.dart';
import 'screens/register_screen.dart';
import 'screens/session_screen.dart';
import 'services/conversation_service.dart';
import 'services/auth_service.dart';
import 'services/relay_client.dart';
import 'theme.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const TetherApp());
}

class TetherApp extends StatefulWidget {
  const TetherApp({super.key});

  @override
  State<TetherApp> createState() => _TetherAppState();
}

class _TetherAppState extends State<TetherApp> {
  late final ThemeNotifier _themeNotifier;
  late final LocaleNotifier _localeNotifier;
  late final AuthService _authService;
  late final RelayClient _relayClient;
  late final ConversationService _conversationService;
  late final GoRouter _router;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _themeNotifier = ThemeNotifier();
    _localeNotifier = LocaleNotifier();
    _authService = AuthService();
    _relayClient = RelayClient(authService: _authService);
    _conversationService = ConversationService();
    _router = _buildRouter();
    _initialize();
  }

  Future<void> _initialize() async {
    await Future.wait<void>([
      _themeNotifier.load(),
      _localeNotifier.load(),
      _authService.checkStoredToken(),
    ]);
    if (mounted) {
      setState(() {
        _ready = true;
      });
    }
  }

  GoRouter _buildRouter() {
    return GoRouter(
      initialLocation: '/shell',
      refreshListenable: _authService,
      redirect: (context, state) {
        final loggedIn = _authService.isAuthenticated;
        final onAuthRoute = state.matchedLocation == '/login' ||
            state.matchedLocation == '/register';
        if (!loggedIn && !onAuthRoute) {
          return '/login';
        }
        if (loggedIn && onAuthRoute) {
          return '/shell';
        }
        return null;
      },
      routes: [
        GoRoute(
          path: '/login',
          builder: (context, state) => const LoginScreen(),
        ),
        GoRoute(
          path: '/register',
          builder: (context, state) => const RegisterScreen(),
        ),
        GoRoute(path: '/shell', builder: (context, state) => const AppShell()),
        GoRoute(
          path: '/session/:id',
          builder: (context, state) =>
              SessionScreen(sessionId: state.pathParameters['id'] ?? ''),
        ),
        GoRoute(
          path: '/replay/:id',
          builder: (context, state) =>
              ReplayScreen(sessionId: state.pathParameters['id'] ?? ''),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_ready) {
      return MaterialApp(
        theme: buildTetherThemeData(Brightness.light),
        darkTheme: buildTetherThemeData(Brightness.dark),
        home: const Scaffold(body: Center(child: CircularProgressIndicator())),
      );
    }

    return MultiProvider(
      providers: [
        ChangeNotifierProvider<ThemeNotifier>.value(value: _themeNotifier),
        ChangeNotifierProvider<LocaleNotifier>.value(value: _localeNotifier),
        ChangeNotifierProvider<AuthService>.value(value: _authService),
        ChangeNotifierProvider<RelayClient>.value(value: _relayClient),
        ChangeNotifierProvider<ConversationService>.value(
          value: _conversationService,
        ),
      ],
      child: Consumer2<ThemeNotifier, LocaleNotifier>(
        builder: (context, themeNotifier, localeNotifier, child) {
          return MaterialApp.router(
            debugShowCheckedModeBanner: false,
            title: 'Tether',
            theme: buildTetherThemeData(Brightness.light),
            darkTheme: buildTetherThemeData(Brightness.dark),
            themeMode: themeNotifier.themeMode,
            locale: localeNotifier.locale,
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            routerConfig: _router,
          );
        },
      ),
    );
  }
}
