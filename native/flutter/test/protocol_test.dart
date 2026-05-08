import 'package:flutter_test/flutter_test.dart';
import 'package:tether/models/protocol.dart';

void main() {
  group('RelayClientToServerFrame', () {
    test('ClientAuth.toJson includes token', () {
      const frame = ClientAuth(token: 'tok');
      expect(frame.toJson(), {'type': 'client.auth', 'token': 'tok'});
    });

    test('ClientAuth.toJson includes ticket', () {
      const frame = ClientAuth(ticket: 'tkt');
      expect(frame.toJson(), {'type': 'client.auth', 'ticket': 'tkt'});
    });

    test('ClientList.toJson returns type only', () {
      expect(const ClientList().toJson(), {'type': 'client.list'});
    });

    test('ClientSubscribe.toJson includes session and mode', () {
      const frame = ClientSubscribe(
        sessionId: 's1',
        mode: RelayClientMode.control,
        after: 10,
      );
      expect(frame.toJson(), {
        'type': 'client.subscribe',
        'sessionId': 's1',
        'mode': 'control',
        'after': 10,
      });
    });

    test('ClientChat.toJson includes message', () {
      const frame = ClientChat(sessionId: 's1', message: 'hello');
      expect(frame.toJson(), {
        'type': 'client.chat',
        'sessionId': 's1',
        'message': 'hello',
      });
    });

    test('ClientStop.toJson includes session', () {
      const frame = ClientStop(sessionId: 'sid');
      expect(frame.toJson(), {'type': 'client.stop', 'sessionId': 'sid'});
    });

    test('ClientDetach.toJson includes session', () {
      const frame = ClientDetach(sessionId: 'sid');
      expect(frame.toJson(), {'type': 'client.detach', 'sessionId': 'sid'});
    });

    test('ClientResize.toJson includes cols and rows', () {
      const frame = ClientResize(sessionId: 'sid', cols: 80, rows: 24);
      expect(frame.toJson(), {
        'type': 'client.resize',
        'sessionId': 'sid',
        'cols': 80,
        'rows': 24,
      });
    });
  });

  group('RelayServerToClientFrame.fromJson', () {
    test('client.auth.ok parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'client.auth.ok',
        'clientId': 'abc',
      });
      expect(frame, isA<ClientAuthOk>());
      expect((frame as ClientAuthOk).clientId, 'abc');
    });

    test('client.auth.failed parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'client.auth.failed',
        'code': 'bad_token',
        'message': 'invalid',
      });
      expect(frame, isA<ClientAuthFailed>());
      expect((frame as ClientAuthFailed).code, 'bad_token');
    });

    test('sessions parses relay session list', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'sessions',
        'sessions': [
          {
            'id': 's1',
            'provider': 'claude',
            'title': 'Session',
            'projectPath': '/tmp',
            'agentSessionId': 'agt_1',
            'status': 'running',
            'transport': 'pty-event-stream',
            'lastActiveAt': 1000,
          },
        ],
      });
      expect(frame, isA<Sessions>());
      final session = (frame as Sessions).sessions.single;
      expect(session.id, 's1');
      expect(session.agentSessionId, 'agt_1');
    });

    test('replay.output parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'replay.output',
        'sessionId': 's1',
        'data': 'hello',
        'latestEventId': 42,
      });
      expect(frame, isA<ReplayOutput>());
      expect((frame as ReplayOutput).latestEventId, 42);
    });

    test('replay.done parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'replay.done',
        'sessionId': 's1',
        'latestEventId': 99,
      });
      expect(frame, isA<ReplayDone>());
      expect((frame as ReplayDone).latestEventId, 99);
    });

    test('error parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'error',
        'code': 'gateway_unavailable',
        'message': 'offline',
        'sessionId': 's1',
      });
      expect(frame, isA<TetherError>());
      expect((frame as TetherError).code, 'gateway_unavailable');
    });

    test('hello parses', () {
      final frame = RelayServerToClientFrame.fromJson({
        'type': 'hello',
        'clientId': 'client-1',
        'gatewayId': 'gateway-1',
      });
      expect(frame, isA<Hello>());
      expect((frame as Hello).gatewayId, 'gateway-1');
    });

    test('unknown type throws FormatException', () {
      expect(
        () => RelayServerToClientFrame.fromJson({'type': 'mystery'}),
        throwsA(isA<FormatException>()),
      );
    });
  });
}
