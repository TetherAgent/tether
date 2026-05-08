import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tether/models/conversation.dart';
import 'package:tether/models/protocol.dart';
import 'package:tether/services/auth_service.dart';
import 'package:tether/services/conversation_service.dart';
import 'package:tether/services/relay_client.dart';

class _RelayClientStub extends RelayClient {
  _RelayClientStub()
      : _eventController = StreamController<RelayTerminalEvent>.broadcast(),
        super(authService: AuthService());

  final StreamController<RelayTerminalEvent> _eventController;
  final List<(String, String)> sentMessages = <(String, String)>[];

  @override
  Stream<RelayTerminalEvent> get eventStream => _eventController.stream;

  void emit(RelayTerminalEvent event) {
    _eventController.add(event);
  }

  @override
  void sendChat(String sessionId, String message) {
    sentMessages.add((sessionId, message));
  }

  @override
  void dispose() {
    _eventController.close();
    super.dispose();
  }
}

void main() {
  test('sendMessage forwards to RelayClient.sendChat', () async {
    final relayClient = _RelayClientStub();
    final service = ConversationService();
    service.attach(relayClient, 'session-1');

    await service.sendMessage('hello');

    expect(relayClient.sentMessages, [('session-1', 'hello')]);
    expect(service.turns.first, isA<UserTurn>());
  });

  test('agent.turn becomes AssistantTurn', () async {
    final relayClient = _RelayClientStub();
    final service = ConversationService();
    service.attach(relayClient, 'session-1');

    relayClient.emit(
      const RelayTerminalEvent(
        id: 1,
        sessionId: 'session-1',
        type: 'agent.turn',
        ts: 1,
        payload: {'content': 'done'},
      ),
    );

    await Future<void>.delayed(Duration.zero);
    expect(service.turns.single, isA<AssistantTurn>());
  });

  test('agent.thinking toggles isTyping', () async {
    final relayClient = _RelayClientStub();
    final service = ConversationService();
    service.attach(relayClient, 'session-1');

    relayClient.emit(
      const RelayTerminalEvent(
        id: 1,
        sessionId: 'session-1',
        type: 'agent.thinking',
        ts: 1,
        payload: {'text': 'thinking'},
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(service.isTyping, isTrue);

    relayClient.emit(
      const RelayTerminalEvent(
        id: 2,
        sessionId: 'session-1',
        type: 'agent.thinking',
        ts: 2,
        payload: {'done': true},
      ),
    );
    await Future<void>.delayed(Duration.zero);
    expect(service.isTyping, isFalse);
  });
}
