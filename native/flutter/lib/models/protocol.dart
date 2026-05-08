enum RelaySessionStatus {
  running,
  stopped,
  completed,
  failed,
  lost;

  static RelaySessionStatus fromString(String value) => switch (value) {
        'running' => RelaySessionStatus.running,
        'stopped' => RelaySessionStatus.stopped,
        'completed' => RelaySessionStatus.completed,
        'failed' => RelaySessionStatus.failed,
        'lost' => RelaySessionStatus.lost,
        final unknown => throw FormatException(
            'Unknown RelaySessionStatus: $unknown',
          ),
      };

  String toJson() => name;
}

enum RelayClientMode {
  control,
  observe;

  static RelayClientMode fromString(String value) => switch (value) {
        'control' => RelayClientMode.control,
        'observe' => RelayClientMode.observe,
        final unknown =>
          throw FormatException('Unknown RelayClientMode: $unknown'),
      };

  String toJson() => name;
}

enum RelayAuthTokenClass {
  normalClientAccess,
  normalClientRefresh,
  managementAccess,
  managementRefresh,
  gatewayAccess,
  gatewayRefresh,
  wsTicket;

  static RelayAuthTokenClass fromString(String value) => switch (value) {
        'normal_client_access' => RelayAuthTokenClass.normalClientAccess,
        'normal_client_refresh' => RelayAuthTokenClass.normalClientRefresh,
        'management_access' => RelayAuthTokenClass.managementAccess,
        'management_refresh' => RelayAuthTokenClass.managementRefresh,
        'gateway_access' => RelayAuthTokenClass.gatewayAccess,
        'gateway_refresh' => RelayAuthTokenClass.gatewayRefresh,
        'ws_ticket' => RelayAuthTokenClass.wsTicket,
        final unknown => throw FormatException(
            'Unknown RelayAuthTokenClass: $unknown',
          ),
      };

  String toJson() => switch (this) {
        RelayAuthTokenClass.normalClientAccess => 'normal_client_access',
        RelayAuthTokenClass.normalClientRefresh => 'normal_client_refresh',
        RelayAuthTokenClass.managementAccess => 'management_access',
        RelayAuthTokenClass.managementRefresh => 'management_refresh',
        RelayAuthTokenClass.gatewayAccess => 'gateway_access',
        RelayAuthTokenClass.gatewayRefresh => 'gateway_refresh',
        RelayAuthTokenClass.wsTicket => 'ws_ticket',
      };
}

final class RelayAuthScope {
  const RelayAuthScope({
    required this.accountId,
    required this.workspaceId,
    required this.tokenClass,
    required this.expiresAt,
    required this.jti,
    this.gatewayId,
    this.sessionId,
    this.userId,
    this.adminUserId,
    this.deviceId,
    this.mode,
  });

  final String accountId;
  final String workspaceId;
  final String? gatewayId;
  final String? sessionId;
  final String? userId;
  final String? adminUserId;
  final String? deviceId;
  final RelayClientMode? mode;
  final RelayAuthTokenClass tokenClass;
  final int expiresAt;
  final String jti;

  factory RelayAuthScope.fromJson(Map<String, dynamic> json) => RelayAuthScope(
        accountId: json['accountId'] as String,
        workspaceId: json['workspaceId'] as String,
        gatewayId: json['gatewayId'] as String?,
        sessionId: json['sessionId'] as String?,
        userId: json['userId'] as String?,
        adminUserId: json['adminUserId'] as String?,
        deviceId: json['deviceId'] as String?,
        mode: json['mode'] == null
            ? null
            : RelayClientMode.fromString(json['mode'] as String),
        tokenClass:
            RelayAuthTokenClass.fromString(json['tokenClass'] as String),
        expiresAt: json['expiresAt'] as int,
        jti: json['jti'] as String,
      );

  Map<String, dynamic> toJson() => {
        'accountId': accountId,
        'workspaceId': workspaceId,
        if (gatewayId != null) 'gatewayId': gatewayId,
        if (sessionId != null) 'sessionId': sessionId,
        if (userId != null) 'userId': userId,
        if (adminUserId != null) 'adminUserId': adminUserId,
        if (deviceId != null) 'deviceId': deviceId,
        if (mode != null) 'mode': mode!.toJson(),
        'tokenClass': tokenClass.toJson(),
        'expiresAt': expiresAt,
        'jti': jti,
      };
}

final class RelaySession {
  const RelaySession({
    required this.id,
    required this.provider,
    required this.title,
    required this.projectPath,
    required this.status,
    required this.transport,
    required this.lastActiveAt,
    this.accountId,
    this.workspaceId,
    this.gatewayId,
    this.userId,
    this.agentSessionId,
  });

  final String id;
  final String provider;
  final String title;
  final String projectPath;
  final String? accountId;
  final String? workspaceId;
  final String? gatewayId;
  final String? userId;
  final String? agentSessionId;
  final RelaySessionStatus status;
  final String transport;
  final int lastActiveAt;

  factory RelaySession.fromJson(Map<String, dynamic> json) => RelaySession(
        id: json['id'] as String,
        provider: json['provider'] as String,
        title: json['title'] as String,
        projectPath: json['projectPath'] as String,
        accountId: json['accountId'] as String?,
        workspaceId: json['workspaceId'] as String?,
        gatewayId: json['gatewayId'] as String?,
        userId: json['userId'] as String?,
        agentSessionId: json['agentSessionId'] as String?,
        status: RelaySessionStatus.fromString(json['status'] as String),
        transport: json['transport'] as String,
        lastActiveAt: json['lastActiveAt'] as int,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'provider': provider,
        'title': title,
        'projectPath': projectPath,
        if (accountId != null) 'accountId': accountId,
        if (workspaceId != null) 'workspaceId': workspaceId,
        if (gatewayId != null) 'gatewayId': gatewayId,
        if (userId != null) 'userId': userId,
        if (agentSessionId != null) 'agentSessionId': agentSessionId,
        'status': status.toJson(),
        'transport': transport,
        'lastActiveAt': lastActiveAt,
      };
}

final class RelayTerminalEvent {
  const RelayTerminalEvent({
    required this.id,
    required this.sessionId,
    required this.type,
    required this.ts,
    required this.payload,
  });

  final int id;
  final String sessionId;
  final String type;
  final int ts;
  final Map<String, dynamic> payload;

  factory RelayTerminalEvent.fromJson(Map<String, dynamic> json) =>
      RelayTerminalEvent(
        id: json['id'] as int,
        sessionId: json['sessionId'] as String,
        type: json['type'] as String,
        ts: json['ts'] as int,
        payload: (json['payload'] as Map<String, dynamic>?) ?? const {},
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'sessionId': sessionId,
        'type': type,
        'ts': ts,
        'payload': payload,
      };
}

sealed class RelayClientToServerFrame {
  const RelayClientToServerFrame();

  Map<String, dynamic> toJson();
}

final class ClientAuth extends RelayClientToServerFrame {
  const ClientAuth({this.token, this.ticket, this.scope, this.secret});

  final String? token;
  final String? ticket;
  final RelayAuthScope? scope;
  final String? secret;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.auth',
        if (token != null) 'token': token,
        if (ticket != null) 'ticket': ticket,
        if (scope != null) 'scope': scope!.toJson(),
        if (secret != null) 'secret': secret,
      };
}

final class ClientList extends RelayClientToServerFrame {
  const ClientList();

  @override
  Map<String, dynamic> toJson() => {'type': 'client.list'};
}

final class ClientSubscribe extends RelayClientToServerFrame {
  const ClientSubscribe({
    required this.sessionId,
    required this.mode,
    this.after,
    this.tail,
    this.cols,
    this.rows,
  });

  final String sessionId;
  final int? after;
  final int? tail;
  final RelayClientMode mode;
  final int? cols;
  final int? rows;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.subscribe',
        'sessionId': sessionId,
        if (after != null) 'after': after,
        if (tail != null) 'tail': tail,
        'mode': mode.toJson(),
        if (cols != null) 'cols': cols,
        if (rows != null) 'rows': rows,
      };
}

final class ClientInput extends RelayClientToServerFrame {
  const ClientInput({required this.sessionId, required this.data});

  final String sessionId;
  final String data;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.input',
        'sessionId': sessionId,
        'data': data,
      };
}

final class ClientResize extends RelayClientToServerFrame {
  const ClientResize({
    required this.sessionId,
    required this.cols,
    required this.rows,
  });

  final String sessionId;
  final int cols;
  final int rows;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.resize',
        'sessionId': sessionId,
        'cols': cols,
        'rows': rows,
      };
}

final class ClientStop extends RelayClientToServerFrame {
  const ClientStop({required this.sessionId});

  final String sessionId;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.stop',
        'sessionId': sessionId,
      };
}

final class ClientDetach extends RelayClientToServerFrame {
  const ClientDetach({required this.sessionId});

  final String sessionId;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.detach',
        'sessionId': sessionId,
      };
}

final class ClientChat extends RelayClientToServerFrame {
  const ClientChat({required this.sessionId, required this.message});

  final String sessionId;
  final String message;

  @override
  Map<String, dynamic> toJson() => {
        'type': 'client.chat',
        'sessionId': sessionId,
        'message': message,
      };
}

sealed class RelayServerToClientFrame {
  const RelayServerToClientFrame();

  factory RelayServerToClientFrame.fromJson(Map<String, dynamic> json) {
    return switch (json['type'] as String? ?? '') {
      'client.auth.ok' => ClientAuthOk(clientId: json['clientId'] as String),
      'client.auth.failed' => ClientAuthFailed(
          code: json['code'] as String,
          message: json['message'] as String,
        ),
      'sessions' => Sessions(
          sessions: (json['sessions'] as List<dynamic>)
              .map(
                (entry) => RelaySession.fromJson(entry as Map<String, dynamic>),
              )
              .toList(),
        ),
      'hello' => Hello(
          clientId: json['clientId'] as String,
          gatewayId: json['gatewayId'] as String?,
        ),
      'event' => Event(
          event: RelayTerminalEvent.fromJson(
            json['event'] as Map<String, dynamic>,
          ),
        ),
      'replay.output' => ReplayOutput(
          sessionId: json['sessionId'] as String,
          data: json['data'] as String,
          latestEventId: json['latestEventId'] as int,
        ),
      'replay.done' => ReplayDone(
          sessionId: json['sessionId'] as String,
          latestEventId: json['latestEventId'] as int,
        ),
      'error' => TetherError(
          code: json['code'] as String,
          message: json['message'] as String,
          sessionId: json['sessionId'] as String?,
        ),
      final unknown => throw FormatException(
          'Unknown RelayServerToClientFrame type: $unknown',
        ),
    };
  }
}

final class ClientAuthOk extends RelayServerToClientFrame {
  const ClientAuthOk({required this.clientId});

  final String clientId;
}

final class ClientAuthFailed extends RelayServerToClientFrame {
  const ClientAuthFailed({required this.code, required this.message});

  final String code;
  final String message;
}

final class Sessions extends RelayServerToClientFrame {
  const Sessions({required this.sessions});

  final List<RelaySession> sessions;
}

final class Hello extends RelayServerToClientFrame {
  const Hello({required this.clientId, this.gatewayId});

  final String clientId;
  final String? gatewayId;
}

final class Event extends RelayServerToClientFrame {
  const Event({required this.event});

  final RelayTerminalEvent event;
}

final class ReplayOutput extends RelayServerToClientFrame {
  const ReplayOutput({
    required this.sessionId,
    required this.data,
    required this.latestEventId,
  });

  final String sessionId;
  final String data;
  final int latestEventId;
}

final class ReplayDone extends RelayServerToClientFrame {
  const ReplayDone({required this.sessionId, required this.latestEventId});

  final String sessionId;
  final int latestEventId;
}

final class TetherError extends RelayServerToClientFrame {
  const TetherError({
    required this.code,
    required this.message,
    this.sessionId,
  });

  final String code;
  final String message;
  final String? sessionId;
}
