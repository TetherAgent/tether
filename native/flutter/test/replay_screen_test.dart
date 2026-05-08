import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:tether/l10n/app_localizations.dart';
import 'package:tether/models/protocol.dart';
import 'package:tether/screens/replay_screen.dart';
import 'package:tether/services/auth_service.dart';
import 'package:tether/services/relay_client.dart';

class _RelayClientStub extends RelayClient {
  _RelayClientStub(this.history)
      : _controller = StreamController<ReplayOutput>.broadcast(),
        super(authService: AuthService());

  final List<RelaySession> history;
  final StreamController<ReplayOutput> _controller;

  @override
  Stream<ReplayOutput> get replayOutputStream => _controller.stream;

  @override
  List<RelaySession> get historySessions => history;

  void emit(ReplayOutput frame) {
    _controller.add(frame);
  }

  @override
  void dispose() {
    _controller.close();
    super.dispose();
  }
}

void main() {
  testWidgets('ReplayScreen shows session title and replay label',
      (tester) async {
    final relayClient = _RelayClientStub([
      const RelaySession(
        id: 's1',
        provider: 'claude',
        title: 'Demo session',
        projectPath: '/tmp',
        status: RelaySessionStatus.completed,
        transport: 'pty-event-stream',
        lastActiveAt: 1,
      ),
    ]);

    await tester.pumpWidget(
      ChangeNotifierProvider<RelayClient>.value(
        value: relayClient,
        child: const MaterialApp(
          localizationsDelegates: [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          supportedLocales: AppLocalizations.supportedLocales,
          home: ReplayScreen(sessionId: 's1'),
        ),
      ),
    );

    expect(find.textContaining('Demo session'), findsOneWidget);
  });
}
