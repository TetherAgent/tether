import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/models/protocol.dart';
import 'package:tether/screens/session_list_screen.dart';
import 'package:tether/services/auth_service.dart';
import 'package:tether/services/relay_client.dart';
import 'package:tether/theme.dart';
import 'package:tether/widgets/session_card.dart';

class _RelayClientStub extends RelayClient {
  _RelayClientStub({
    required List<RelaySession> sessions,
    bool gatewayUnavailable = false,
  }) : super(authService: AuthService()) {
    this.sessions = sessions;
    this.gatewayUnavailable = gatewayUnavailable;
  }
}

RelaySession _session({
  required String id,
  required String provider,
  String title = '',
  RelaySessionStatus status = RelaySessionStatus.running,
}) {
  return RelaySession(
    id: id,
    provider: provider,
    title: title,
    projectPath: '/tmp/project',
    status: status,
    transport: 'pty-event-stream',
    lastActiveAt: 1000,
  );
}

void main() {
  Widget buildApp(RelayClient relayClient) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<RelayClient>.value(value: relayClient),
        ChangeNotifierProvider<ThemeNotifier>(create: (_) => ThemeNotifier()),
        ChangeNotifierProvider<LocaleNotifier>(create: (_) => LocaleNotifier()),
      ],
      child: MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const SessionListScreen(),
      ),
    );
  }

  testWidgets('SessionCard falls back to provider when title empty',
      (tester) async {
    final relayClient =
        _RelayClientStub(sessions: [_session(id: 's1', provider: 'claude')]);
    await tester.pumpWidget(buildApp(relayClient));

    expect(find.text('claude'), findsOneWidget);
  });

  testWidgets('active session uses Dismissible', (tester) async {
    final relayClient =
        _RelayClientStub(sessions: [_session(id: 's1', provider: 'claude')]);
    await tester.pumpWidget(buildApp(relayClient));

    expect(find.byType(Dismissible), findsOneWidget);
    expect(find.byType(SessionCard), findsOneWidget);
  });

  testWidgets('gateway_unavailable shows dedicated empty state',
      (tester) async {
    final relayClient = _RelayClientStub(
      sessions: const [],
      gatewayUnavailable: true,
    );
    await tester.pumpWidget(buildApp(relayClient));

    expect(find.byIcon(Icons.wifi_off), findsOneWidget);
  });

  testWidgets('history sessions render inside history tab', (tester) async {
    final relayClient = _RelayClientStub(
      sessions: [
        _session(id: 's1', provider: 'claude'),
        _session(
          id: 's2',
          provider: 'codex',
          status: RelaySessionStatus.completed,
        ),
      ],
    );
    await tester.pumpWidget(buildApp(relayClient));

    expect(find.byType(TabBar), findsOneWidget);
    await tester.tap(find.byType(Tab).last);
    await tester.pumpAndSettle();

    expect(find.text('codex'), findsOneWidget);
  });
}
