import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/screens/login_screen.dart';
import 'package:tether/services/auth_service.dart';
import 'package:tether/theme.dart';

class _AuthServiceStub extends AuthService {
  _AuthServiceStub({this.shouldFail = false});

  final bool shouldFail;

  @override
  Future<void> login({required String email, required String password}) async {
    if (shouldFail) {
      throw const AuthException('bad_credentials');
    }
  }
}

void main() {
  testWidgets('LoginScreen navigates to /shell on success', (tester) async {
    final router = GoRouter(
      routes: [
        GoRoute(path: '/', builder: (_, __) => const LoginScreen()),
        GoRoute(
          path: '/shell',
          builder: (_, __) => const Scaffold(body: Text('shell')),
        ),
      ],
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthService>.value(value: _AuthServiceStub()),
        ],
        child: MaterialApp.router(
          routerConfig: router,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          theme: buildTetherThemeData(Brightness.light),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField).at(0), 'demo@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'secret');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(find.text('shell'), findsOneWidget);
  });

  testWidgets('LoginScreen shows auth error', (tester) async {
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider<AuthService>.value(
            value: _AuthServiceStub(shouldFail: true),
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: const LoginScreen(),
        ),
      ),
    );

    await tester.enterText(find.byType(TextField).at(0), 'demo@example.com');
    await tester.enterText(find.byType(TextField).at(1), 'bad');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(find.text('bad_credentials'), findsOneWidget);
  });
}
