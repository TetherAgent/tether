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
  String? _errorBanner;

  List<ConversationTurn> get turns =>
      List<ConversationTurn>.unmodifiable(_turns);

  bool get isTyping => _isTyping;

  String? get errorBanner => _errorBanner;

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
    final localId = _nextId('pending');
    _turns.add(
      UserTurn(
        id: localId,
        content: trimmed,
        status: ChatMessageStatus.pending,
      ),
    );
    notifyListeners();
    try {
      relayClient.sendChat(sessionId, trimmed);
      _updateUserStatus(localId, ChatMessageStatus.sent);
      _errorBanner = null;
    } catch (_) {
      _updateUserStatus(localId, ChatMessageStatus.failed);
      _errorBanner = '发送失败，请检查连接后重试。';
    }
    notifyListeners();
  }

  void retryMessage(UserTurn turn) {
    _turns.removeWhere((item) => item.id == turn.id);
    notifyListeners();
    unawaited(sendMessage(turn.content));
  }

  void cancelGeneration() {
    final relayClient = _relayClient;
    final sessionId = _sessionId;
    if (relayClient == null || sessionId == null) {
      return;
    }
    relayClient.sendInput(sessionId, '\x03');
  }

  void clear() {
    _turns.clear();
    _isTyping = false;
    _errorBanner = null;
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
          _upsertUserTurn(content);
        } else {
          _turns.add(AssistantTurn(id: _nextId(), content: content));
        }
      case 'agent.turn':
        final content = payload['content'] as String? ?? '';
        final role = payload['role'] as String? ?? 'assistant';
        if (role == 'user') {
          _upsertUserTurn(content);
        } else {
          _turns.add(AssistantTurn(id: _nextId(), content: content));
        }
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

  void _upsertUserTurn(String content) {
    final pendingIndex = _turns.indexWhere(
      (turn) =>
          turn is UserTurn &&
          (turn.status == ChatMessageStatus.pending ||
              turn.status == ChatMessageStatus.sent) &&
          turn.content == content,
    );
    if (pendingIndex != -1) {
      final pending = _turns[pendingIndex] as UserTurn;
      _turns[pendingIndex] = pending.copyWith(
        status: ChatMessageStatus.delivered,
      );
      return;
    }
    _turns.add(
      UserTurn(
        id: _nextId(),
        content: content,
        status: ChatMessageStatus.delivered,
      ),
    );
  }

  void _updateUserStatus(String id, ChatMessageStatus status) {
    final index = _turns.indexWhere((turn) => turn.id == id);
    if (index == -1 || _turns[index] is! UserTurn) {
      return;
    }
    final turn = _turns[index] as UserTurn;
    _turns[index] = turn.copyWith(status: status);
  }

  String _nextId([String prefix = 'turn']) => '$prefix-${_turnCounter++}';

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
