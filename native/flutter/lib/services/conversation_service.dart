import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/conversation.dart';
import '../models/protocol.dart';
import 'relay_client.dart';

class ConversationService extends ChangeNotifier {
  final List<ConversationTurn> _turns = <ConversationTurn>[];

  RelayClient? _relayClient;
  String? _sessionId;
  StreamSubscription<RelayTerminalEvent>? _subscription;
  int _turnCounter = 0;
  bool _isTyping = false;

  List<ConversationTurn> get turns =>
      List<ConversationTurn>.unmodifiable(_turns);

  bool get isTyping => _isTyping;

  void attach(RelayClient relayClient, String sessionId) {
    _subscription?.cancel();
    _relayClient = relayClient;
    _sessionId = sessionId;
    clear();
    _subscription = relayClient.eventStream.listen((event) {
      if (event.sessionId != sessionId) {
        return;
      }
      _handleEvent(event);
    });
  }

  Future<void> sendMessage(String text) async {
    final relayClient = _relayClient;
    final sessionId = _sessionId;
    if (relayClient == null || sessionId == null) {
      return;
    }
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      return;
    }
    _turns.add(UserTurn(id: _nextId(), content: trimmed));
    relayClient.sendChat(sessionId, trimmed);
    notifyListeners();
  }

  void clear() {
    _turns.clear();
    _isTyping = false;
    _turnCounter = 0;
    notifyListeners();
  }

  void _handleEvent(RelayTerminalEvent event) {
    final payload = event.payload;
    switch (event.type) {
      case 'chat.message':
        final role = payload['role'] as String? ?? 'assistant';
        final content = payload['content'] as String? ?? '';
        if (role == 'user') {
          _turns.add(UserTurn(id: _nextId(), content: content));
        } else {
          _turns.add(AssistantTurn(id: _nextId(), content: content));
        }
      case 'agent.turn':
        final content = payload['content'] as String? ?? '';
        _turns.add(AssistantTurn(id: _nextId(), content: content));
        _isTyping = false;
      case 'agent.thinking':
        final content = payload['text'] as String? ?? '';
        final done = payload['done'] == true || payload['active'] == false;
        _isTyping = !done;
        if (!done && content.isNotEmpty) {
          _turns.add(
            AssistantTurn(
              id: _nextId(),
              content: content,
              status: ConversationTurnStatus.thinking,
            ),
          );
        }
      case 'tool.call':
        _turns.add(
          ToolCallTurn(
            id: _nextId(),
            toolCall: ToolCallInfo(
              toolCallId: payload['toolCallId'] as String? ?? '',
              toolName: payload['toolName'] as String? ?? '',
              input: (payload['input'] as Map<String, dynamic>?) ??
                  <String, dynamic>{},
            ),
          ),
        );
      case 'tool.result':
        _turns.add(
          ToolResultTurn(
            id: _nextId(),
            toolCallId: payload['toolCallId'] as String? ?? '',
            output: payload['output'] as String? ?? '',
          ),
        );
      case 'select.options':
        final options = (payload['options'] as List<dynamic>? ?? const [])
            .map(
                (entry) => SelectOption.fromJson(entry as Map<String, dynamic>))
            .toList();
        _turns.add(SelectOptionsTurn(id: _nextId(), options: options));
    }
    notifyListeners();
  }

  String _nextId() => 'turn-${_turnCounter++}';

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
