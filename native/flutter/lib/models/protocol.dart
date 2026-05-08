// Dart mirror of packages/protocol/src/index.ts
// Hand-written bridge — do not maintain separately; codegen placeholder: packages/protocol/scripts/gen-dart.ts

/// Session status matching Web/Gateway values.
enum SessionStatus { running, stopped, completed, failed, lost }

SessionStatus sessionStatusFromString(String s) => switch (s) {
      'running' => SessionStatus.running,
      'stopped' => SessionStatus.stopped,
      'completed' => SessionStatus.completed,
      'failed' => SessionStatus.failed,
      _ => SessionStatus.lost,
    };

class RelaySession {
  final String id;
  final String? title;
  final String? provider;
  final String? agentSessionId;
  final String? projectPath;
  final SessionStatus status;
  final int? lastActiveAt;

  const RelaySession({
    required this.id,
    this.title,
    this.provider,
    this.agentSessionId,
    this.projectPath,
    required this.status,
    this.lastActiveAt,
  });

  factory RelaySession.fromJson(Map<String, dynamic> j) => RelaySession(
        id: j['id'] as String,
        title: j['title'] as String?,
        provider: j['provider'] as String?,
        agentSessionId: j['agentSessionId'] as String?,
        projectPath: j['projectPath'] as String?,
        status: sessionStatusFromString(j['status'] as String? ?? 'lost'),
        lastActiveAt: j['lastActiveAt'] as int?,
      );
}

// ── Server-to-client frames ──────────────────────────────────────────────────

sealed class RelayFrame {}

class FrameClientAuthOk extends RelayFrame {
  final String clientId;
  FrameClientAuthOk(this.clientId);
}

class FrameClientAuthFailed extends RelayFrame {
  final String code;
  final String message;
  FrameClientAuthFailed(this.code, this.message);
}

class FrameHello extends RelayFrame {
  final String clientId;
  FrameHello(this.clientId);
}

class FrameSessionList extends RelayFrame {
  final List<RelaySession> sessions;
  FrameSessionList(this.sessions);
}

class FrameReplayDone extends RelayFrame {
  final String sessionId;
  final int latestEventId;
  FrameReplayDone(this.sessionId, this.latestEventId);
}

class FrameEvent extends RelayFrame {
  final Map<String, dynamic> event;
  FrameEvent(this.event);
}

class FrameError extends RelayFrame {
  final String? sessionId;
  final String code;
  final String message;
  FrameError(this.sessionId, this.code, this.message);
}

class FrameUnknown extends RelayFrame {
  final String type;
  FrameUnknown(this.type);
}

RelayFrame parseRelayFrame(Map<String, dynamic> j) {
  final type = j['type'] as String? ?? '';
  return switch (type) {
    'client.auth.ok' => FrameClientAuthOk(j['clientId'] as String),
    'client.auth.failed' => FrameClientAuthFailed(
        j['code'] as String,
        j['message'] as String,
      ),
    'hello' => FrameHello(j['clientId'] as String),
    'session.list' => FrameSessionList(
        (j['sessions'] as List<dynamic>)
            .map((e) => RelaySession.fromJson(e as Map<String, dynamic>))
            .toList(),
      ),
    'replay.done' => FrameReplayDone(
        j['sessionId'] as String,
        j['latestEventId'] as int,
      ),
    'event' => FrameEvent(j['event'] as Map<String, dynamic>),
    'error' => FrameError(
        j['sessionId'] as String?,
        j['code'] as String? ?? 'unknown',
        j['message'] as String? ?? '',
      ),
    _ => FrameUnknown(type),
  };
}

// ── Agent event types ────────────────────────────────────────────────────────

enum AgentRuntimeStatus { idle, submitted, running, responding, done, exited, disconnected }

AgentRuntimeStatus agentStatusFromString(String s) => switch (s) {
      'idle' => AgentRuntimeStatus.idle,
      'submitted' => AgentRuntimeStatus.submitted,
      'running' => AgentRuntimeStatus.running,
      'responding' => AgentRuntimeStatus.responding,
      'done' => AgentRuntimeStatus.done,
      'exited' => AgentRuntimeStatus.exited,
      _ => AgentRuntimeStatus.disconnected,
    };

class ToolInfo {
  final String name;
  final String inputSummary;
  const ToolInfo({required this.name, required this.inputSummary});

  factory ToolInfo.fromJson(Map<String, dynamic> j) => ToolInfo(
        name: j['name'] as String? ?? '',
        inputSummary: j['inputSummary'] as String? ?? '',
      );
}

class SelectOption {
  final int index;
  final String label;
  const SelectOption({required this.index, required this.label});

  factory SelectOption.fromJson(Map<String, dynamic> j) => SelectOption(
        index: j['index'] as int,
        label: j['label'] as String,
      );
}
