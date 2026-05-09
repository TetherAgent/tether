import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/conversation.dart';
import '../models/protocol.dart';
import 'relay_client.dart';

const _chatEnterDelay = Duration(milliseconds: 20);

class ConversationService extends ChangeNotifier {
  final List<ConversationTurn> _turns = <ConversationTurn>[];

  RelayClient? _relayClient;
  String? _sessionId;
  StreamSubscription<RelayTerminalEvent>? _subscription;
  StreamSubscription<ConversationFrame>? _conversationSubscription;
  int _turnCounter = 0;
  bool _isTyping = false;
  String? _errorBanner;

  List<ConversationTurn> get turns =>
      List<ConversationTurn>.unmodifiable(_turns);

  String? get sessionId => _sessionId;

  bool get isTyping => _isTyping;

  String? get errorBanner => _errorBanner;

  void attach(RelayClient relayClient, String sessionId) {
    _subscription?.cancel();
    _conversationSubscription?.cancel();
    _relayClient = relayClient;
    _sessionId = sessionId;
    clear();
    _subscription = relayClient.eventStream.listen((event) {
      if (event.sessionId != sessionId) {
        return;
      }
      _handleEvent(event);
    });
    _conversationSubscription = relayClient.conversationStream.listen((frame) {
      if (frame.sessionId != sessionId) {
        return;
      }
      _replaceWithConversation(frame.turns);
    });
    refreshConversation();
  }

  void refreshConversation() {
    final relayClient = _relayClient;
    final sessionId = _sessionId;
    if (relayClient == null || sessionId == null) {
      return;
    }
    unawaited(_refreshConversationSnapshot(relayClient, sessionId));
    relayClient.subscribe(sessionId, mode: RelayClientMode.control, after: 0);
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
      final wireValue = trimmed.replaceAll(RegExp(r'\s*\r?\n\s*'), ' ');
      await relayClient.authService.sendSessionInput(sessionId, wireValue);
      await Future<void>.delayed(_chatEnterDelay);
      await relayClient.authService.sendSessionInput(sessionId, '\r');
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
      case 'agent.select':
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

  Future<void> _refreshConversationSnapshot(
    RelayClient relayClient,
    String sessionId,
  ) async {
    try {
      final data = await relayClient.authService.getSessionConversation(
        sessionId,
      );
      final turns = (data['turns'] as List<dynamic>? ?? const [])
          .map(
            (entry) => RelayConversationTurn.fromJson(
              entry as Map<String, dynamic>,
            ),
          )
          .toList();
      _replaceWithConversation(turns);
    } catch (_) {
      // Server DB miss returns an empty array; do not fall back to Relay WS reads.
    }
  }

  void _replaceWithConversation(List<RelayConversationTurn> turns) {
    _turns
      ..clear()
      ..addAll(
        turns.map<ConversationTurn>((turn) {
          if (turn.role == 'user') {
            return UserTurn(
              id: 'conversation-${turn.turnIndex}',
              content: turn.content,
              status: ChatMessageStatus.delivered,
            );
          }
          return AssistantTurn(
            id: 'conversation-${turn.turnIndex}',
            content: turn.content,
          );
        }),
      );
    _isTyping = false;
    _errorBanner = null;
    notifyListeners();
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
    _conversationSubscription?.cancel();
    super.dispose();
  }
}
