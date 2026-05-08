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
        _conversationController = StreamController<ConversationFrame>.broadcast(),
        super(authService: AuthService());

  final StreamController<RelayTerminalEvent> _eventController;
  final StreamController<ConversationFrame> _conversationController;
  final List<(String, String)> sentMessages = <(String, String)>[];
  final List<String> conversationRequests = <String>[];

  @override
  Stream<RelayTerminalEvent> get eventStream => _eventController.stream;

  @override
  Stream<ConversationFrame> get conversationStream =>
      _conversationController.stream;

  void emit(RelayTerminalEvent event) {
    _eventController.add(event);
  }

  void emitConversation(ConversationFrame frame) {
    _conversationController.add(frame);
  }

  @override
  void sendChat(String sessionId, String message) {
    sentMessages.add((sessionId, message));
  }

  @override
  void requestConversation(String sessionId) {
    conversationRequests.add(sessionId);
  }

  @override
  void dispose() {
    _eventController.close();
    _conversationController.close();
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

  test('conversation snapshot replaces structured turns', () async {
    final relayClient = _RelayClientStub();
    final service = ConversationService();
    service.attach(relayClient, 'session-1');

    expect(relayClient.conversationRequests, ['session-1']);
    relayClient.emitConversation(
      const ConversationFrame(
        sessionId: 'session-1',
        turns: [
          RelayConversationTurn(
            id: 1,
            sessionId: 'session-1',
            turnIndex: 0,
            role: 'user',
            content: '1',
            tools: [],
            createdAt: 1,
          ),
          RelayConversationTurn(
            id: 2,
            sessionId: 'session-1',
            turnIndex: 1,
            role: 'assistant',
            content: '结构化回复',
            tools: [],
            createdAt: 2,
          ),
        ],
      ),
    );

    await Future<void>.delayed(Duration.zero);
    expect(service.turns, hasLength(2));
    expect((service.turns[0] as UserTurn).content, '1');
    expect((service.turns[1] as AssistantTurn).content, '结构化回复');
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

  test('agent.select becomes SelectOptionsTurn', () async {
    final relayClient = _RelayClientStub();
    final service = ConversationService();
    service.attach(relayClient, 'session-1');

    relayClient.emit(
      const RelayTerminalEvent(
        id: 1,
        sessionId: 'session-1',
        type: 'agent.select',
        ts: 1,
        payload: {
          'options': [
            {'index': 1, 'label': '继续刚才的任务'},
          ],
          'raw': '1. 继续刚才的任务',
        },
      ),
    );
    await Future<void>.delayed(Duration.zero);

    final turn = service.turns.single as SelectOptionsTurn;
    expect(turn.options.single.id, '1');
    expect(turn.options.single.label, '继续刚才的任务');
  });
}
