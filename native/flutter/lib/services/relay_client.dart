import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../models/protocol.dart';
import 'auth_service.dart';

typedef RelaySocketFactory = Future<RelaySocket> Function(Uri uri);

abstract interface class RelaySocket {
  void listen({
    required void Function(String message) onMessage,
    required void Function(Object error) onError,
    required void Function() onDone,
  });

  void send(String data);

  Future<void> close();
}

class IORelaySocket implements RelaySocket {
  IORelaySocket(this._socket);

  final WebSocket _socket;

  @override
  void listen({
    required void Function(String message) onMessage,
    required void Function(Object error) onError,
    required void Function() onDone,
  }) {
    _socket.listen(
      (dynamic event) => onMessage(event as String),
      onError: onError,
      onDone: onDone,
      cancelOnError: true,
    );
  }

  @override
  void send(String data) => _socket.add(data);

  @override
  Future<void> close() => _socket.close();
}

class RelayClient extends ChangeNotifier {
  RelayClient({
    required this.authService,
    RelaySocketFactory? socketFactory,
    List<int>? reconnectBackoffSeconds,
    Duration? listRefreshInterval,
  })  : _socketFactory = socketFactory ?? _defaultSocketFactory,
        _reconnectBackoffSeconds =
            reconnectBackoffSeconds ?? const [1, 2, 4, 8, 16, 30],
        _listRefreshInterval =
            listRefreshInterval ?? const Duration(seconds: 3);

  final AuthService authService;
  final RelaySocketFactory _socketFactory;
  final List<int> _reconnectBackoffSeconds;
  final Duration _listRefreshInterval;
  final StreamController<RelayTerminalEvent> _eventController =
      StreamController<RelayTerminalEvent>.broadcast();
  final StreamController<ConversationFrame> _conversationController =
      StreamController<ConversationFrame>.broadcast();
  final StreamController<ReplayOutput> _replayOutputController =
      StreamController<ReplayOutput>.broadcast();
  final Map<String, int> _latestEventIds = <String, int>{};

  RelaySocket? _socket;
  Timer? _listTimer;
  Timer? _reconnectTimer;
  bool _disposed = false;
  bool _authFailed = false;
  int _reconnectAttempt = 0;
  String? _currentSessionId;
  RelayClientMode _currentMode = RelayClientMode.observe;
  int? _currentCols;
  int? _currentRows;

  String status = 'idle';
  bool hasLoaded = false;
  bool gatewayUnavailable = false;
  List<RelaySession> sessions = <RelaySession>[];

  Stream<RelayTerminalEvent> get eventStream => _eventController.stream;

  Stream<ConversationFrame> get conversationStream =>
      _conversationController.stream;

  Stream<ReplayOutput> get replayOutputStream => _replayOutputController.stream;

  bool get isConnected => _socket != null && status != 'disconnected';

  List<RelaySession> get activeSessions => sessions
      .where((session) => session.status == RelaySessionStatus.running)
      .toList();

  List<RelaySession> get historySessions {
    final activeIds = activeSessions.map((session) => session.id).toSet();
    return sessions
        .where((session) => !activeIds.contains(session.id))
        .take(8)
        .toList();
  }

  static Future<RelaySocket> _defaultSocketFactory(Uri uri) async {
    final socket = await WebSocket.connect(uri.toString());
    return IORelaySocket(socket);
  }

  static Uri buildRelayUri(String relayUrl) {
    final parsed = Uri.parse(relayUrl);
    final scheme = switch (parsed.scheme) {
      'https' => 'wss',
      'http' => 'ws',
      final other => other,
    };
    final hasClientPath = parsed.path.endsWith('/client');
    final normalizedPath = parsed.path.isEmpty
        ? '/client'
        : hasClientPath
            ? parsed.path
            : '${parsed.path.replaceFirst(RegExp(r'/$'), '')}/client';
    return parsed.replace(scheme: scheme, path: normalizedPath);
  }

  int nextReconnectDelaySeconds() {
    final index =
        _reconnectAttempt.clamp(0, _reconnectBackoffSeconds.length - 1);
    return _reconnectBackoffSeconds[index];
  }

  Future<void> connect() async {
    _listTimer?.cancel();
    _reconnectTimer?.cancel();
    _authFailed = false;
    status = 'connecting';
    notifyListeners();

    final relayUrl = await authService.readRelayUrl() ?? kDefaultRelayUrl;
    final uri = buildRelayUri(relayUrl);
    final token = await authService.readAccessToken();

    _socket = await _socketFactory(uri);
    _socket!.listen(
      onMessage: _handleMessage,
      onError: _handleSocketError,
      onDone: _handleSocketDone,
    );
    sendFrame(ClientAuth(token: token));
  }

  Future<void> disconnect() async {
    _listTimer?.cancel();
    _reconnectTimer?.cancel();
    _authFailed = false;
    _currentSessionId = null;
    sessions = <RelaySession>[];
    gatewayUnavailable = false;
    hasLoaded = false;
    status = 'idle';
    final socket = _socket;
    _socket = null;
    await socket?.close();
    notifyListeners();
  }

  void sendFrame(RelayClientToServerFrame frame) {
    _socket?.send(jsonEncode(frame.toJson()));
  }

  void sendChat(String sessionId, String message) {
    sendFrame(ClientChat(sessionId: sessionId, message: message));
  }

  void requestConversation(String sessionId) {
    sendFrame(ClientConversation(sessionId: sessionId));
  }

  void sendInput(String sessionId, String data) {
    sendFrame(ClientInput(sessionId: sessionId, data: data));
  }

  void subscribe(
    String sessionId, {
    RelayClientMode mode = RelayClientMode.observe,
    int? after,
    int? tail,
    int? cols,
    int? rows,
  }) {
    _currentSessionId = sessionId;
    _currentMode = mode;
    _currentCols = cols;
    _currentRows = rows;
    sendFrame(
      ClientSubscribe(
        sessionId: sessionId,
        mode: mode,
        after: after ?? _latestEventIds[sessionId],
        tail: tail,
        cols: cols,
        rows: rows,
      ),
    );
  }

  void stopSession(String sessionId) {
    sendFrame(ClientStop(sessionId: sessionId));
  }

  void _handleMessage(String rawMessage) {
    final decoded = jsonDecode(rawMessage) as Map<String, dynamic>;
    final frame = RelayServerToClientFrame.fromJson(decoded);

    switch (frame) {
      case ClientAuthOk():
        _reconnectAttempt = 0;
        gatewayUnavailable = false;
        status = 'connected';
        sendFrame(const ClientList());
        _listTimer?.cancel();
        _listTimer = Timer.periodic(_listRefreshInterval, (_) {
          sendFrame(const ClientList());
        });
        if (_currentSessionId != null) {
          subscribe(
            _currentSessionId!,
            mode: _currentMode,
            cols: _currentCols,
            rows: _currentRows,
          );
        }
      case ClientAuthFailed():
        _authFailed = true;
        status = frame.message;
        hasLoaded = true;
      case Sessions():
        sessions = frame.sessions;
        hasLoaded = true;
        gatewayUnavailable = false;
      case Hello():
        status = 'hello:${frame.clientId}';
      case Event():
        _latestEventIds[frame.event.sessionId] = frame.event.id;
        _eventController.add(frame.event);
      case ConversationFrame():
        _conversationController.add(frame);
      case ReplayOutput():
        _latestEventIds[frame.sessionId] = frame.latestEventId;
        _replayOutputController.add(frame);
      case ReplayDone():
        _latestEventIds[frame.sessionId] = frame.latestEventId;
      case TetherError():
        hasLoaded = true;
        status = frame.message;
        if (frame.code == 'gateway_unavailable') {
          sessions = <RelaySession>[];
          gatewayUnavailable = true;
        }
    }

    notifyListeners();
  }

  void _handleSocketError(Object error) {
    status = 'error';
    notifyListeners();
    _scheduleReconnect();
  }

  void _handleSocketDone() {
    _listTimer?.cancel();
    _socket = null;
    if (_authFailed || _disposed) {
      return;
    }
    status = 'disconnected';
    hasLoaded = true;
    notifyListeners();
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_authFailed || _disposed) {
      return;
    }
    _reconnectTimer?.cancel();
    final delaySeconds = nextReconnectDelaySeconds();
    _reconnectAttempt += 1;
    _reconnectTimer = Timer(Duration(seconds: delaySeconds), () {
      unawaited(connect());
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _listTimer?.cancel();
    _reconnectTimer?.cancel();
    unawaited(_socket?.close());
    _eventController.close();
    _conversationController.close();
    _replayOutputController.close();
    super.dispose();
  }
}
