import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tether/services/auth_service.dart';
import 'package:tether/services/relay_client.dart';

class _FakeSocket implements RelaySocket {
  final List<String> sent = <String>[];
  void Function(String message)? _onMessage;
  void Function(Object error)? _onError;
  void Function()? _onDone;

  @override
  void listen({
    required void Function(String message) onMessage,
    required void Function(Object error) onError,
    required void Function() onDone,
  }) {
    _onMessage = onMessage;
    _onError = onError;
    _onDone = onDone;
  }

  void emit(Map<String, dynamic> message) {
    _onMessage?.call(jsonEncode(message));
  }

  void fail(Object error) {
    _onError?.call(error);
  }

  void closeFromServer() {
    _onDone?.call();
  }

  @override
  void send(String data) {
    sent.add(data);
  }

  @override
  Future<void> close() async {}
}

class _AuthStub extends AuthService {
  _AuthStub();

  @override
  Future<String?> readAccessToken() async => 'access-token';

  @override
  Future<String?> readRelayUrl() async => 'wss://relay.example.com/client';
}

void main() {
  test('buildRelayUri preserves existing /client path', () {
    expect(
      RelayClient.buildRelayUri('https://relay.example.com/client').toString(),
      'wss://relay.example.com/client',
    );
  });

  test('buildRelayUri appends /client path when missing', () {
    expect(
      RelayClient.buildRelayUri('https://relay.example.com').toString(),
      'wss://relay.example.com/client',
    );
  });

  test('sendChat emits client.chat frame', () async {
    final socket = _FakeSocket();
    final client = RelayClient(
      authService: _AuthStub(),
      socketFactory: (_) async => socket,
    );

    await client.connect();
    client.sendChat('session-1', 'hello');

    final frames = socket.sent
        .map((entry) => jsonDecode(entry) as Map<String, dynamic>)
        .toList();
    expect(
      frames.any(
        (frame) =>
            frame['type'] == 'client.chat' &&
            frame['sessionId'] == 'session-1' &&
            frame['message'] == 'hello',
      ),
      isTrue,
    );
  });

  test('client.auth.failed stops reconnect attempts from changing state',
      () async {
    final socket = _FakeSocket();
    final client = RelayClient(
      authService: _AuthStub(),
      socketFactory: (_) async => socket,
      reconnectBackoffSeconds: const [1],
    );

    await client.connect();
    socket.emit({
      'type': 'client.auth.failed',
      'code': 'bad_token',
      'message': 'invalid',
    });
    socket.closeFromServer();

    expect(client.status, 'invalid');
    expect(client.hasLoaded, isTrue);
  });

  test('replay.output is published to replayOutputStream', () async {
    final socket = _FakeSocket();
    final client = RelayClient(
      authService: _AuthStub(),
      socketFactory: (_) async => socket,
    );
    final outputs = <String>[];
    final subscription = client.replayOutputStream.listen((frame) {
      outputs.add(frame.data);
    });

    await client.connect();
    socket.emit({
      'type': 'replay.output',
      'sessionId': 'session-1',
      'data': 'chunk',
      'latestEventId': 7,
    });

    await Future<void>.delayed(Duration.zero);
    expect(outputs, ['chunk']);
    await subscription.cancel();
  });

  test('subscribe replays current session after auth ok', () async {
    final socket = _FakeSocket();
    final client = RelayClient(
      authService: _AuthStub(),
      socketFactory: (_) async => socket,
    );

    await client.connect();
    client.subscribe('session-42');
    socket.emit({'type': 'client.auth.ok', 'clientId': 'client-1'});

    final frames = socket.sent
        .map((entry) => jsonDecode(entry) as Map<String, dynamic>)
        .toList();
    expect(
      frames.any((frame) => frame['type'] == 'client.list'),
      isTrue,
    );
    expect(
      frames.any(
        (frame) =>
            frame['type'] == 'client.subscribe' &&
            frame['sessionId'] == 'session-42' &&
            frame['mode'] == 'observe',
      ),
      isTrue,
    );
  });
}
