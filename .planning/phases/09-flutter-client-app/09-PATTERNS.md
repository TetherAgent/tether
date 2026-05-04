# Phase 9: Flutter Client App - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 14 (new/modified files)
**Analogs found:** 10 / 14 (4 files have no direct codebase analog — they are Dart-first patterns documented below)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `native/flutter/lib/main.dart` | config/entry | request-response | `native/flutter/lib/main.dart` (existing stub) | partial — existing stub is counter demo, not real app |
| `native/flutter/lib/models/protocol.dart` | model | transform | `packages/protocol/src/index.ts` | role-match (TypeScript → Dart) |
| `native/flutter/lib/services/relay_client.dart` | service | event-driven | `apps/web/src/main.tsx` SessionList relay useEffect (lines 452–556) | role-match |
| `native/flutter/lib/services/lan_client.dart` | service | request-response + event-driven | `apps/web/src/main.tsx` refreshDirect + SessionSurface LAN WS (lines 405–450) | role-match |
| `native/flutter/lib/services/auth_service.dart` | service | request-response | `apps/web/src/contexts/auth-context.tsx` + `apps/web/src/lib/api.ts` | role-match |
| `native/flutter/lib/screens/login_screen.dart` | component | request-response | `apps/web/src/contexts/auth-context.tsx` loginNormal (lines 127–135) | partial |
| `native/flutter/lib/screens/register_screen.dart` | component | request-response | `apps/web/src/contexts/auth-context.tsx` registerNormal (lines 136–145) | partial |
| `native/flutter/lib/screens/session_list_screen.dart` | component | event-driven | `apps/web/src/main.tsx` SessionList + SessionCard (lines 382–894) | role-match |
| `native/flutter/lib/screens/terminal_screen.dart` | component | streaming | `apps/web/src/components/session/session-surface.tsx` | role-match |
| `native/flutter/lib/screens/replay_screen.dart` | component | streaming | `apps/web/src/pages/session-replay-page.tsx` + `session-surface.tsx` | role-match |
| `native/flutter/lib/screens/settings_screen.dart` | component | request-response | `apps/web/src/main.tsx` ConnectionSettingsControl (lines 322–380) | partial |
| `native/flutter/lib/i18n/messages.dart` | config | transform | `apps/web/src/i18n/messages.ts` (full file) | exact (structure mirror) |
| `packages/protocol/scripts/gen-dart.sh` | utility | — | none | no analog |
| `native/flutter/pubspec.yaml` | config | — | `native/flutter/pubspec.yaml` (existing minimal stub) | partial |

---

## Pattern Assignments

### `native/flutter/lib/main.dart` (config/entry, request-response)

**Analog:** `native/flutter/lib/main.dart` (existing stub at lines 1–122, replace entirely)

**What to copy:** MaterialApp structure from the stub; discard counter-demo content and replace with real app scaffold.

**Existing stub structure** (lines 1–36):
```dart
import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
      ),
      home: const MyHomePage(title: 'Flutter Demo Home Page'),
    );
  }
}
```

**Target pattern** — replace with:
```dart
// main.dart entry point pattern
// - ThemeData.dark() with tetherBackground colorScheme
// - ThemeMode.system default, toggled via SharedPreferences tether:theme
// - Named routes: /login, /sessions, /session/:id, /replay/:id, /settings
// - Locale: zh/en from SharedPreferences tether:locale; fallback zh
// - WidgetsFlutterBinding.ensureInitialized() before runApp for secure_storage
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const TetherApp());
}
```

**Color constant pattern** (from UI-SPEC.md color table):
```dart
// Declare as top-level const — no ThemeData.colorScheme.fromSeed()
const Color tetherBackground = Color(0xFF0c0e10);
const Color tetherSurface    = Color(0xFF171a1f);
const Color tetherBorder     = Color(0xFF2b3137);
const Color tetherInputBorder = Color(0xFF3a424b);
const Color tetherAccent     = Color(0xFF8fd0ff);
const Color tetherForeground  = Color(0xFFe8ecef);
const Color tetherMuted       = Color(0xFF9aa4af);
const Color tetherDestructive = Color(0xFFe05252);
```

---

### `native/flutter/lib/models/protocol.dart` (model, transform)

**Analog:** `packages/protocol/src/index.ts` (lines 1–85 — full file, read already)

**TypeScript union → Dart sealed class mapping:**

| TypeScript type | Dart sealed class |
|---|---|
| `RelaySessionStatus` | `enum RelaySessionStatus` |
| `RelayClientMode` | `enum RelayClientMode` |
| `RelaySession` | `final class RelaySession` |
| `RelayTerminalEvent` | `final class RelayTerminalEvent` |
| `RelayClientToServerFrame` | `sealed class RelayClientToServerFrame` |
| `RelayServerToClientFrame` | `sealed class RelayServerToClientFrame` |

**Source TypeScript — RelayClientToServerFrame** (`packages/protocol/src/index.ts` lines 67–75):
```typescript
export type RelayClientToServerFrame =
  | { type: 'client.auth'; token?: string; ticket?: string; scope?: RelayAuthScope; secret?: string }
  | { type: 'client.list' }
  | { type: 'client.subscribe'; sessionId: string; after?: number; tail?: number; mode: RelayClientMode }
  | { type: 'client.input'; sessionId: string; data: string }
  | { type: 'client.resize'; sessionId: string; cols: number; rows: number }
  | { type: 'client.stop'; sessionId: string }
  | { type: 'client.detach'; sessionId: string };
```

**Source TypeScript — RelayServerToClientFrame** (`packages/protocol/src/index.ts` lines 77–84):
```typescript
export type RelayServerToClientFrame =
  | { type: 'client.auth.ok'; clientId: string }
  | { type: 'client.auth.failed'; code: string; message: string }
  | { type: 'sessions'; sessions: RelaySession[] }
  | { type: 'hello'; clientId: string; gatewayId?: string }
  | { type: 'event'; event: RelayTerminalEvent }
  | { type: 'replay.done'; sessionId: string; latestEventId: number }
  | { type: 'error'; sessionId?: string; code: string; message: string };
```

**Source TypeScript — RelaySession** (`packages/protocol/src/index.ts` lines 28–40):
```typescript
export type RelaySession = {
  id: string;
  provider: string;
  title: string;
  projectPath: string;
  accountId?: string;
  workspaceId?: string;
  gatewayId?: string;
  userId?: string;
  status: RelaySessionStatus;
  transport: 'pty-event-stream' | 'tmux';
  lastActiveAt: number;
};
```

**Target Dart sealed class pattern** (from RESEARCH.md Pattern 3):
```dart
// lib/models/protocol.dart
// Native Dart 3 sealed classes — no freezed required
// Each variant is a 'final class' extending the sealed parent
// fromJson uses a switch expression on json['type']
// toJson returns Map<String, dynamic>

enum RelaySessionStatus { running, stopped, completed, failed, lost }
enum RelayClientMode { control, observe }

final class RelaySession {
  final String id;
  final String provider;
  final String title;
  final String projectPath;
  final RelaySessionStatus status;
  final int lastActiveAt;
  // ... optional fields: accountId, workspaceId, gatewayId, userId
  const RelaySession({required this.id, required this.provider, ...});
  factory RelaySession.fromJson(Map<String, dynamic> json) { ... }
}

sealed class RelayServerToClientFrame {
  const RelayServerToClientFrame();
  factory RelayServerToClientFrame.fromJson(Map<String, dynamic> json) {
    return switch (json['type'] as String) {
      'client.auth.ok'     => ClientAuthOk(clientId: json['clientId'] as String),
      'client.auth.failed' => ClientAuthFailed(code: ..., message: ...),
      'sessions'           => Sessions(sessions: ...),
      'hello'              => Hello(clientId: ...),
      'event'              => Event(event: RelayTerminalEvent.fromJson(...)),
      'replay.done'        => ReplayDone(sessionId: ..., latestEventId: ...),
      'error'              => TetherError(code: ..., message: ..., sessionId: ...),
      _ => throw FormatException('Unknown frame type: ${json['type']}'),
    };
  }
}

final class ClientAuthOk extends RelayServerToClientFrame {
  final String clientId;
  const ClientAuthOk({required this.clientId});
}
// ... remaining variants follow same pattern
```

**Exhaustiveness check usage** (enforced by Dart 3 compiler):
```dart
// In relay_client.dart, switch on sealed type — compiler errors on missing variants
switch (frame) {
  case ClientAuthOk(:final clientId): ...
  case ClientAuthFailed(:final code, :final message): ...
  case Sessions(:final sessions): ...
  case Hello(): break;
  case Event(:final event): ...
  case ReplayDone(:final sessionId, :final latestEventId): ...
  case TetherError(:final code, :final message): ...
}
```

---

### `native/flutter/lib/services/relay_client.dart` (service, event-driven)

**Analog:** `apps/web/src/main.tsx` SessionList relay useEffect, lines 452–556

**Relay WS connect pattern** (from `apps/web/src/main.tsx` lines 464–482):
```typescript
// Web: build WS URL, open, send auth on open
ws = new WebSocket(buildRelayClientUrl(connectionSettings.relayUrl, t));
ws.addEventListener('open', () => {
  setStatus(t.statusRelayAuth);
  ws?.send(JSON.stringify(
    normalAuth?.accessToken
      ? { type: 'client.auth', token: normalAuth.accessToken }
      : { type: 'client.auth', secret: connectionSettings.relaySecret }
  ));
});
```

**Relay frame dispatch pattern** (from `apps/web/src/main.tsx` lines 485–531):
```typescript
// Web: on message, parse, dispatch on frame.type
ws.addEventListener('message', (message) => {
  const frame = parsedFrame as RelayServerToClientFrame;
  if (frame.type === 'client.auth.ok') {
    setStatus(`${t.relayClientStatusPrefix} · ${frame.clientId.slice(0, 8)}`);
    sendList();
    timer = window.setInterval(sendList, 3000);
  }
  if (frame.type === 'sessions') {
    const next = splitActiveSessions(frame.sessions);
    setSessions(next.active);
    setHistory(next.history);
    setHasLoadedSessions(true);
  }
  if (frame.type === 'error' && frame.code === 'gateway_unavailable') {
    setSessions([]);
    setHistory([]);
    setRelayGatewayUnavailable(true);
    setStatus(t.gatewayNotConnected);
  }
});
```

**splitActiveSessions** (from `apps/web/src/main.tsx` lines 134–141):
```typescript
function splitActiveSessions(allSessions: Session[]): { active: Session[]; history: Session[] } {
  const active = allSessions.filter((session) => session.status === 'running');
  const activeIds = new Set(active.map((session) => session.id));
  return {
    active,
    history: allSessions.filter((session) => !activeIds.has(session.id)).slice(0, 8)
  };
}
```

**WS close/error pattern** (from `apps/web/src/main.tsx` lines 532–545):
```typescript
ws.addEventListener('close', () => {
  if (!disposed) { setStatus(t.statusRelayClosed); setHasLoadedSessions(true); }
});
ws.addEventListener('error', () => {
  if (!disposed) { setStatus(t.statusRelayError); setHasLoadedSessions(true); }
});
```

**Target Dart pattern** (from RESEARCH.md Pattern 1):
```dart
// relay_client.dart — mirrors the Web state machine above
// latestEventIds stored as Map<String, int> — never in widget state
// Exponential backoff: [1, 2, 4, 8, 16, 30] seconds
// AppLifecycleState.resumed triggers reconnectIfNeeded()
// sendList() every 3s via Timer.periodic after auth.ok

class RelayService extends ChangeNotifier {
  WebSocket? _ws;
  Timer? _listTimer;
  Timer? _backoffTimer;
  final List<int> _backoffSeconds = [1, 2, 4, 8, 16, 30];
  int _backoffIndex = 0;
  final Map<String, int> _latestEventIds = {};
  
  List<RelaySession> activeSessions = [];
  List<RelaySession> historySessions = [];
  bool gatewayUnavailable = false;
  String status = '';

  Future<void> connect(String relayUrl, String token) async { ... }
  void subscribe(String sessionId, RelayClientMode mode) { ... }
  void sendInput(String sessionId, String data) { ... }
  void sendResize(String sessionId, int cols, int rows) { ... }
  void sendStop(String sessionId) { ... }
  void _scheduleReconnect() { ... }
  void reconnectIfNeeded() { if (_ws == null) connect(...); }
}
```

---

### `native/flutter/lib/services/lan_client.dart` (service, request-response + event-driven)

**Analog:** `apps/web/src/main.tsx` refreshDirect (lines 405–440) and `apps/web/src/components/session/session-surface.tsx` LAN WS ticket flow

**LAN session list fetch pattern** (from `apps/web/src/main.tsx` lines 405–440):
```typescript
const refreshDirect = React.useCallback(async () => {
  const [sessionsResponse, historyResponse, gatewaysResponse] = await Promise.all([
    gatewayRequest('/api/sessions'),
    gatewayRequest('/api/sessions?all=1'),
    gatewayRequest('/api/gateways')
  ]);
  if (sessionsResponse.status === 401 ...) { logoutNormal(); }
  const sessionsData = await sessionsResponse.json() as { sessions: Session[] };
  const active = sessionsData.sessions.filter((s) => s.status === 'running');
  setSessions(active);
  setHistory(historyData.sessions.filter(...).slice(0, 8));
}, [...]);
```

**LAN poll timer** (from `apps/web/src/main.tsx` lines 442–450):
```typescript
React.useEffect(() => {
  if (connectionSettings.connectionMode !== 'direct') return undefined;
  refreshDirect();
  const timer = window.setInterval(refreshDirect, 3000);
  return () => window.clearInterval(timer);
}, [connectionSettings.connectionMode, refreshDirect]);
```

**WS ticket flow** (from RESEARCH.md Pattern 5):
```dart
// POST gateway_url/api/ws-ticket → {ticket}
// WebSocket URL: gateway_url/api/sessions/:id/stream?ticket=TOKEN&mode=control&surface=flutter
Future<void> connectLan(String gatewayUrl, String sessionId, String accessToken, String mode) async {
  final ticketRes = await _dio.post(
    '$gatewayUrl/api/ws-ticket',
    options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    data: {'sessionId': sessionId, 'mode': mode, 'surface': 'flutter'},
  );
  final ticket = ticketRes.data['ticket'] as String;
  final wsUrl = '$gatewayUrl/api/sessions/${Uri.encodeComponent(sessionId)}/stream'
      '?ticket=${Uri.encodeComponent(ticket)}&mode=$mode&surface=flutter';
  // open WebSocket with same event protocol as Relay
}
```

**Authorization header pattern** (from `apps/web/src/lib/api.ts` lines 77–80):
```typescript
export function gatewayAuthHeaders(token?: string): HeadersInit | undefined {
  const accessToken = token || getStoredNormalAccessToken();
  if (!accessToken) { return undefined; }
  return { Authorization: `Bearer ${accessToken}` };
}
```

---

### `native/flutter/lib/services/auth_service.dart` (service, request-response)

**Analog:** `apps/web/src/contexts/auth-context.tsx` (full file) + `apps/web/src/lib/api.ts` (loginNormal, registerNormal, refreshNormal)

**Login flow pattern** (from `apps/web/src/contexts/auth-context.tsx` lines 127–135):
```typescript
loginNormal: async (input) => {
  const result = await loginNormal(input);
  const record: AuthStorageRecord<NormalIdentity> = {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken
  };
  persistNormal(record);
  // then validate token to get identity
},
```

**Token validation + silent refresh** (from `apps/web/src/contexts/auth-context.tsx` lines 80–109):
```typescript
const validateNormalSession = async () => {
  const stored = readStorage<NormalIdentity>(NORMAL_STORAGE_KEY);
  if (!stored?.accessToken) { logoutNormal(); return false; }
  try {
    const identity = await validateNormal(stored.accessToken);
    persistNormal({ ...stored, identity });
    return true;
  } catch {
    try {
      const refreshed = await refreshNormal(stored.refreshToken);
      // ... persist new tokens
      return true;
    } catch (refreshError) {
      if (shouldClearStoredAuth(refreshError)) { logoutNormal(); return false; }
      setNormalAuth(stored); return true;
    }
  }
};
```

**Token storage pattern** (from RESEARCH.md Pattern 4):
```dart
// flutter_secure_storage — never SharedPreferences for tokens
static const _storage = FlutterSecureStorage();
static const _accessKey  = 'tether:access_token';
static const _refreshKey = 'tether:refresh_token';

Future<String?> readAccessToken() => _storage.read(key: _accessKey);
Future<void> writeTokens({required String access, required String refresh}) async {
  await _storage.write(key: _accessKey, value: access);
  await _storage.write(key: _refreshKey, value: refresh);
}
Future<void> clearAll() => _storage.deleteAll();
```

**dio token refresh interceptor pattern** (from RESEARCH.md Code Examples):
```dart
class TokenRefreshInterceptor extends QueuedInterceptor {
  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      final refresh = await _store.readRefreshToken();
      if (refresh == null) { handler.next(err); return; }
      try {
        final res = await Dio().post('$_serverUrl/refresh', data: {'refreshToken': refresh});
        final newAccess = res.data['accessToken'] as String;
        await _store.writeAccessToken(newAccess);
        handler.resolve(await Dio().fetch(
          err.requestOptions..headers['Authorization'] = 'Bearer $newAccess',
        ));
      } catch (_) {
        await _store.clearAll();
        handler.next(err);
      }
    } else {
      handler.next(err);
    }
  }
}
```

**Auth state on app start** (from `apps/web/src/contexts/auth-context.tsx` lines 111–122):
```typescript
React.useEffect(() => {
  const normal = readStorage<NormalIdentity>(NORMAL_STORAGE_KEY);
  setNormalAuth(normal);
  void (normal ? validateNormalSession() : Promise.resolve(false)).finally(() => setAuthReady(true));
}, [validateNormalSession]);
```

Flutter equivalent: call `authService.checkStoredToken()` in `initState` / app startup; redirect to login if returns false.

---

### `native/flutter/lib/screens/login_screen.dart` (component, request-response)

**Analog:** `apps/web/src/contexts/auth-context.tsx` loginNormal (lines 127–135) — behavioral contract; UI shape from UI-SPEC.md Screen 1.

**Web auth call shape**:
```typescript
// POST /login with { email, password }
// On success: { accessToken, refreshToken }
// On failure 401: display error inline below button
const result = await loginNormal({ email, password });
```

**Flutter layout pattern** (from UI-SPEC.md Screen 1):
```dart
// Centered card, max-width 360dp, horizontal padding 16dp
// Column: "Tether" (20sp SemiBold) → "Agent 控制台" (12sp muted)
//       → email TextField → password TextField (obscureText: true)
//       → ElevatedButton (48dp height, full-width) "登录"
//       → TextButton "还没有账号？注册"
// Loading state: CircularProgressIndicator(16dp) inside button, fields disabled
// Error state: Text below button, tetherDestructive color, 15sp

// Error/loading state pattern (mirrors Web interaction states):
bool _isLoading = false;
String? _errorMessage;

ElevatedButton(
  onPressed: _isLoading ? null : _submit,
  child: _isLoading
    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
    : const Text('登录'),
)
```

---

### `native/flutter/lib/screens/register_screen.dart` (component, request-response)

**Analog:** `apps/web/src/contexts/auth-context.tsx` registerNormal (lines 136–145)

**Web register call shape**:
```typescript
// POST /register with { email, password, displayName? }
// Same token response as login
const result = await registerNormal({ email, password, displayName });
```

**Flutter layout pattern** (from UI-SPEC.md Screen 2):
```dart
// Same card structure as login
// Fields: displayName + email + password + confirmPassword
// Inline field validation errors: 12sp tetherDestructive below field
// CTA: "注册" (48dp); footer: "已有账号？登录"
```

---

### `native/flutter/lib/screens/session_list_screen.dart` (component, event-driven)

**Analog:** `apps/web/src/main.tsx` SessionList component (lines 382–739) + SessionCard (lines 826–894)

**Session split pattern** (from `apps/web/src/main.tsx` lines 134–141 — copy this logic exactly):
```typescript
function splitActiveSessions(allSessions) {
  const active = allSessions.filter((s) => s.status === 'running');
  const activeIds = new Set(active.map((s) => s.id));
  return {
    active,
    history: allSessions.filter((s) => !activeIds.has(s.id)).slice(0, 8)
  };
}
```

**Stats row pattern** (from `apps/web/src/main.tsx` lines 651–668 — matches D-34):
```typescript
<div className="session-metrics">
  <div className="session-metric">
    <Activity /> <span>{t.activeSessions}</span> <strong>{sessions.length}</strong>
  </div>
  <div className="session-metric">
    <Clock3 /> <span>{t.history}</span> <strong>{history.length}</strong>
  </div>
  <div className="session-metric">
    <Router /> <span>{t.gatewayList}</span>
    <strong>{isRelayMode ? t.relay : gateways.length}</strong>
  </div>
</div>
```

**Gateway panel pattern** (from `apps/web/src/main.tsx` lines 694–714 — matches D-36):
```typescript
<section className="gateway-list">
  <h2>{isRelayMode ? t.relay : activeGateway?.url ?? t.noGateways}</h2>
  <span>{connectionSettings.connectionMode}</span>
  {gateways.length > 0 ? (
    gateways.map((gw) => <div><Server /> <span>{gw.url}</span> <span>PID {gw.pid}</span></div>)
  ) : (
    <p>{isRelayMode ? t.relayGatewayHint : t.noGatewaysDescription}</p>
  )}
</section>
```

**gateway_unavailable empty state** (from `apps/web/src/main.tsx` lines 589–595 — matches D-35):
```typescript
const emptyStateIcon = isRelayGatewayUnavailable ? <WifiOff /> : <MonitorDot />;
const emptyStateTitle = isRelayGatewayUnavailable ? t.gatewayNotConnected : t.noSessions;
const emptyStateDescription = isRelayGatewayUnavailable
  ? t.relayGatewayUnavailableDescription
  : t.noSessionsDescription;
```

**Session card title fallback** (from `apps/web/src/main.tsx` line 842 — matches D-17):
```typescript
const sessionName = session.title || session.provider || session.id;
// Card shows: session.title || session.provider
```

**History section pattern** (from `apps/web/src/main.tsx` lines 718–733 — matches D-16):
```typescript
{history.length > 0 ? (
  <details open>
    <summary><Clock3 />{t.history} <strong>{history.length}</strong></summary>
    <div>{history.map((s) => <SessionCard session={s} target="replay" />)}</div>
  </details>
) : null}
```

Flutter equivalent: `ExpansionTile` with history cards. Active sessions tap → TerminalScreen; history sessions tap → ReplayScreen (matches D-37).

**Swipe-to-stop pattern** (from RESEARCH.md Pattern 7):
```dart
// Dismissible — confirmDismiss returns false so card stays
Dismissible(
  key: Key(session.id),
  direction: DismissDirection.endToStart,
  confirmDismiss: (direction) async {
    await relayService.sendStop(session.id);
    return false; // card slides back, stays in list
  },
  background: Container(
    alignment: Alignment.centerRight,
    color: tetherDestructive,
    padding: const EdgeInsets.only(right: 16),
    child: const Text('停止', style: TextStyle(color: Colors.white, fontSize: 12)),
  ),
  child: SessionCardBody(session: session),
)
```

**Stop action — relay path** (from `apps/web/src/main.tsx` lines 558–570):
```typescript
// Relay stop: subscribe(sessionId, mode: 'control') then stop — same socket
sendRelayFrame(ws, { type: 'client.subscribe', sessionId, mode: 'control' });
sendRelayFrame(ws, { type: 'client.stop', sessionId });
setSessions((current) => current.filter((s) => s.id !== sessionId));
```

**Session status label + tone** (from `apps/web/src/main.tsx` lines 195–233):
```typescript
function sessionStatusLabel(status, t) {
  switch (status) {
    case 'running':   return t.sessionRunning;
    case 'stopped':   return t.sessionStopped;
    case 'completed': return t.sessionCompleted;
    case 'failed':    return t.sessionFailed;
    case 'lost':      return t.sessionLost;
    default:          return status;
  }
}
function statusTone(status) {
  switch (status) {
    case 'running':             return 'running';   // tetherAccent dot
    case 'failed': case 'lost': return 'danger';    // tetherDestructive dot
    case 'completed':           return 'success';   // tetherMuted dot
    default:                    return 'muted';     // tetherMuted dot
  }
}
```

**Time format** (from `apps/web/src/main.tsx` lines 212–219):
```typescript
function formatSessionTime(value: number): string {
  return new Date(value).toLocaleString(undefined, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}
```

Dart equivalent: `DateFormat('MM/dd HH:mm').format(DateTime.fromMillisecondsSinceEpoch(lastActiveAt))`

---

### `native/flutter/lib/screens/terminal_screen.dart` (component, streaming)

**Analog:** `apps/web/src/components/session/session-surface.tsx`

**Web mode toggle pattern** (from `apps/web/src/components/session/session-surface.tsx` lines 39–43):
```typescript
type ClientMode = 'control' | 'observe';
// Toggle sends client.subscribe again with new mode
// Relay path: sendRelayFrame(ws, { type: 'client.subscribe', sessionId, mode: newMode })
```

**xterm TerminalView pattern** (from RESEARCH.md Pattern 2):
```dart
// GestureDetector wraps TerminalView for pinch-to-zoom
// autofocus: true for keyboard input
// readOnly: false for terminal screen
GestureDetector(
  onScaleStart: (details) => _scaleStart = _fontSize,
  onScaleUpdate: (details) => setState(() {
    _fontSize = (_scaleStart * details.scale).clamp(10.0, 24.0);
  }),
  child: TerminalView(
    terminal,
    theme: _tetherTheme,
    textStyle: TerminalStyle(fontSize: _fontSize),
    padding: const EdgeInsets.all(8),  // 8px per UI-SPEC Component Fixed Dimensions
    readOnly: false,
    autofocus: true,
  ),
)

// terminal.onResize fires on layout change — send resize frame
terminal.onResize = (cols, rows, pixelWidth, pixelHeight) {
  relayService.sendResize(sessionId, cols: cols, rows: rows);
};
```

**Keyboard toolbar pattern** (from RESEARCH.md Pattern 6):
```dart
// Toolbar appears when MediaQuery.of(context).viewInsets.bottom > 0
// 48dp height, tetherSurface background
// 3 buttons: Ctrl / Esc / Tab — each 1/3 width

final keyboardVisible = MediaQuery.of(context).viewInsets.bottom > 0;
Column(children: [
  Expanded(child: TerminalWidget()),
  if (keyboardVisible) KeyboardToolbar(),
])
```

**Ctrl modifier pattern** (from RESEARCH.md Pitfall 5 + UI-SPEC):
```dart
// Hold state: tap Ctrl → _ctrlHeld = true (visual: tetherAccent 20% bg + border)
// Next onOutput character: transform via (char.codeUnitAt(0) & 0x1F)
// Reset after one char or 3s timeout
bool _ctrlHeld = false;
Timer? _ctrlTimeout;

void _onCtrlTap() {
  setState(() => _ctrlHeld = true);
  _ctrlTimeout = Timer(const Duration(seconds: 3), () => setState(() => _ctrlHeld = false));
}
// In terminal.onOutput interceptor:
terminal.onOutput = (data) {
  if (_ctrlHeld) {
    _ctrlHeld = false;
    _ctrlTimeout?.cancel();
    final byte = data.codeUnitAt(0) & 0x1F;
    relayService.sendInput(sessionId, String.fromCharCode(byte));
  } else {
    relayService.sendInput(sessionId, data);
  }
};
```

**AppLifecycle reconnect pattern** (from RESEARCH.md Code Examples):
```dart
class _TerminalScreenState extends State<TerminalScreen>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      context.read<RelayService>().reconnectIfNeeded(); // D-23
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
```

**Overlay badge pattern** (from UI-SPEC.md Screen 4):
```dart
// Bottom-center overlay: mode label + connection mode pill
// 12sp Label, tetherMuted text, tetherBackground bg 86% opacity, 1px tetherBorder, pill border-radius
// Positioned above keyboard toolbar when keyboard open
```

**Mode toggle in AppBar** (from UI-SPEC.md Screen 4):
```dart
// Chip/pill showing "控制" or "观察"
// "控制" = tetherAccent text/ring; "观察" = muted
// Tapping toggles mode → sends client.subscribe with new mode
// Observe mode: keyboard toolbar buttons dimmed (opacity 0.4)
```

---

### `native/flutter/lib/screens/replay_screen.dart` (component, streaming)

**Analog:** `apps/web/src/pages/session-replay-page.tsx` + `session-surface.tsx` with `surfaceMode="replay"`

**Web replay behavior** (from `apps/web/src/pages/session-replay-page.tsx` lines 1–7):
```typescript
export function SessionReplayPage(props) {
  return <SessionSurface {...props} surfaceMode="replay" />;
}
// surfaceMode="replay" means: mode='observe', after=0, readOnly=true
```

**Web subscribe-for-replay pattern** (from `apps/web/src/components/session/session-surface.tsx` lines 80–83):
```typescript
// Replay: client.subscribe with mode='observe', after=undefined (or 0 per D-37)
// after: replayMode === 'all' ? undefined : RECENT_REPLAY_EVENT_LIMIT
// Flutter D-37: always after: 0 (full replay from start)
```

**Flutter replay pattern** (from CONTEXT.md D-37, D-38):
```dart
// Replay screen subscribes with mode: 'observe', after: 0
// AppBar: back arrow + "${session.title ?? session.provider}" + "回放" static label
// No keyboard toolbar (D-38)
// TerminalView readOnly: true, autofocus: false
// Pinch-to-zoom still works (same GestureDetector wrapper)
relayService.subscribe(sessionId, mode: RelayClientMode.observe, after: 0);
```

---

### `native/flutter/lib/screens/settings_screen.dart` (component, request-response)

**Analog:** `apps/web/src/main.tsx` ConnectionSettingsControl (lines 322–380)

**Web connection mode selector** (from `apps/web/src/main.tsx` lines 350–376):
```typescript
// Mode selector: 'relay' | 'direct'
// If relay: show Relay URL input
// If direct: show no extra field (Flutter: show LAN Gateway URL field)
<Select value={settings.connectionMode}
  onValueChange={(value) => update({ connectionMode: value as ConnectionMode })}>
  <SelectItem value="direct">{t.direct}</SelectItem>
  <SelectItem value="relay">{t.relay}</SelectItem>
</Select>
{settings.connectionMode === 'relay' ? (
  <Input type="url" value={settings.relayUrl} onChange={...} />
) : null}
```

**Flutter settings pattern** (from UI-SPEC.md Screen 5 + CONTEXT.md D-20, D-25, D-26):
```dart
// Standard ListView with ListTile groups
// Section "连接": RadioListTile for Relay / LAN 直连
// If LAN mode: TextField for Gateway base URL (e.g. http://192.168.1.x:4789)
// Auto-save on change or Apply button
// Shared: save to SharedPreferences key 'tether:connectionMode', 'tether:lanGatewayUrl'
// On pop: notify SessionListScreen to refresh (D-27)
```

---

### `native/flutter/lib/i18n/messages.dart` (config, transform)

**Analog:** `apps/web/src/i18n/messages.ts` (full file, 470 lines — already read)

**Web messages structure** (from `apps/web/src/i18n/messages.ts` lines 6–465):
```typescript
export const WEB_MESSAGES = {
  zh: { appName: 'Tether', noSessions: '暂无 session', activeSessions: '活跃', ... },
  en: { appName: 'Tether', noSessions: 'No active sessions', activeSessions: 'Active', ... }
} as const;
```

**Flutter i18n structure** — use ARB files + `flutter gen-l10n` (from RESEARCH.md Standard Stack):
```
native/flutter/lib/l10n/
  app_zh.arb    # Simplified Chinese strings
  app_en.arb    # English strings
```

**Key string pairs to mirror from Web** (from `apps/web/src/i18n/messages.ts`):

| Key (Web) | zh value | en value |
|---|---|---|
| `noSessions` | 暂无 session | No active sessions |
| `activeSessions` | 活跃 | Active |
| `history` | 历史 | History |
| `gatewayNotConnected` | Gateway 未连接 | Gateway is not connected |
| `relayGatewayUnavailableDescription` | 本机 Gateway 未启动... | The local Gateway is not running... |
| `sessionRunning` | 运行中 | Running |
| `sessionStopped` | 已停止 | Stopped |
| `sessionCompleted` | 已完成 | Completed |
| `sessionFailed` | 失败 | Failed |
| `sessionLost` | 失联 | Lost |
| `relay` | Relay | Relay |
| `direct` | 直连 | Direct |
| `authFailed` | 认证失败 | Authentication failed |
| `statusRelayClosed` | Relay 已断开 | Relay disconnected |
| `observeCannotSend` | 观察模式不能输入 | Observe mode cannot send input |
| `relayClientStatusPrefix` | Relay | Relay |

Plus Flutter-specific strings not in Web (from UI-SPEC.md Copywriting Contract):

| Key | zh | en |
|---|---|---|
| `gatewayUnavailableHeading` | Gateway 未连接 | Gateway not connected |
| `reconnectingPattern` | 正在重连… {n}s 后重试 | Reconnecting… retry in {n}s |
| `lanGatewayUnreachable` | 无法连接 Gateway，请检查地址或网络。 | Cannot reach Gateway, check address or network. |
| `sessionStopSent` | 已发送停止请求 | Stop request sent |
| `replayLabel` | 回放 | Replay |
| `controlLabel` | 控制 | Control |
| `observeLabel` | 观察 | Observe |
| `stopLabel` | 停止 | Stop |
| `loginButton` | 登录 | Sign in |
| `registerButton` | 注册 | Create account |
| `agentConsoleSubtitle` | Agent 控制台 | Agent Console |

**SharedPreferences key** (from CONTEXT.md D-39): `tether:locale`

---

### `packages/protocol/scripts/gen-dart.sh` (utility, —)

**No analog** — placeholder script. From CONTEXT.md D-32:
```bash
#!/usr/bin/env bash
# gen-dart.sh — placeholder for future Dart type generation
# Usage: ./gen-dart.sh
# Intended tool: quicktype (https://quicktype.io) or custom generator
# Source: packages/protocol/src/index.ts
# Output: native/flutter/lib/models/protocol.dart
#
# Currently not functional. Hand-written types in protocol.dart serve as
# the temporary bridge. This script is the documented exit ramp.
echo "Dart codegen not yet implemented. See packages/protocol/src/index.ts for source types."
exit 0
```

---

### `native/flutter/pubspec.yaml` (config, —)

**Analog:** `native/flutter/pubspec.yaml` (existing stub, lines 1–90 — already read)

**Existing stub** has only `cupertino_icons ^1.0.8` as a dependency. The full target pubspec adds all Phase 9 dependencies (from RESEARCH.md Standard Stack):

```yaml
dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  xterm: ^4.0.0                          # terminal widget — pure Dart, OHOS safe
  flutter_secure_storage: ^10.0.0        # token storage (iOS Keychain / Android Keystore)
  dio: ^5.9.2                            # HTTP client with QueuedInterceptor
  shared_preferences: ^2.3.0             # locale + theme persistence only
  web_socket_client: ^0.2.1             # Relay WS with BinaryExponentialBackoff
  flutter_localizations:
    sdk: flutter
  intl: ^0.19.0

dependency_overrides:
  flutter_secure_storage_ohos: ^1.0.0    # OHOS AES secure storage override

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0

flutter:
  uses-material-design: true
  generate: true                          # enables flutter gen-l10n for ARB files
```

**Note on versions:** `shared_preferences` and `intl` versions marked `[ASSUMED]` in RESEARCH.md — verify with `flutter pub upgrade` before finalizing.

---

## Shared Patterns

### Auth: Token Storage
**Source:** `apps/web/src/contexts/auth-context.tsx` logic + `apps/web/src/lib/api.ts` token fields
**Apply to:** `auth_service.dart`, `relay_client.dart`, `lan_client.dart`
```dart
// NEVER SharedPreferences for tokens
// ALWAYS flutter_secure_storage
// Keys: 'tether:access_token', 'tether:refresh_token'
// On 401: attempt silent refresh via dio QueuedInterceptor
// On refresh failure: clearAll() and navigate to login
```

### Error Handling: displayMessage Mapping
**Source:** `apps/web/src/main.tsx` lines 235–250
```typescript
function displayMessage(message: string, t): string {
  switch (message) {
    case 'authentication failed':              return t.authFailed;
    case 'gateway is not connected':           return t.gatewayNotConnected;
    case 'client is not subscribed to this session': return t.sessionNotSubscribed;
    case 'observer clients cannot send input': return t.observeCannotSend;
    case 'observer clients cannot resize':     return t.observeCannotResize;
    default:                                   return message;
  }
}
```
**Apply to:** `relay_client.dart`, `lan_client.dart` — all server error messages must map through this.

### Terminal Theme: Color Constants
**Source:** `apps/web/src/i18n/messages.ts` (palette) + UI-SPEC.md Color table
**Apply to:** `terminal_screen.dart`, `replay_screen.dart`, `main.dart`
```dart
// From RESEARCH.md Pattern 2 — complete 23-color TerminalTheme
static const TerminalTheme _tetherTheme = TerminalTheme(
  cursor: Color(0xFF8fd0ff),
  selection: Color(0x408fd0ff),
  foreground: Color(0xFFe8ecef),
  background: Color(0xFF0c0e10),
  // ... all 23 fields as specified in RESEARCH.md Pattern 2
);
```

### WebSocket Session Subscription Resume
**Source:** `apps/web/src/main.tsx` lines 486–499 (client.auth.ok → sendList) + CONTEXT.md D-24
**Apply to:** `relay_client.dart`, `lan_client.dart`
```dart
// latestEventId stored per sessionId in service singleton (not widget state)
// Pitfall 4: never store in widget — widget dispose clears it
// On subscribe: send after: _latestEventIds[sessionId]  (null on first attach)
// On every Event frame: _latestEventIds[event.sessionId] = event.id
// On ReplayDone: _latestEventIds[sessionId] = latestEventId
```

### Connection Mode Persistence
**Source:** `apps/web/src/main.tsx` lines 107–132 (localStorage keys + readConnectionSettings)
**Apply to:** `settings_screen.dart`, `session_list_screen.dart`
```typescript
// Web keys: 'tether:connectionMode', 'tether:relayUrl'
// Flutter keys (SharedPreferences): 'tether:connectionMode', 'tether:lanGatewayUrl'
// Mode switch triggers session list refresh (D-27)
```

### Observe Mode Input Block
**Source:** `apps/web/src/main.tsx` line 97 (`statusObserveCannotInput`) + UI-SPEC.md Interaction States
**Apply to:** `terminal_screen.dart`
```dart
// In observe mode: keyboard toolbar buttons visually dimmed (opacity 0.4)
// onOutput should not forward input when mode == RelayClientMode.observe
// Show snackbar/toast: observeCannotSend message if user tries to type
```

---

## No Analog Found

Files with no close match in the existing codebase (planner uses RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/protocol/scripts/gen-dart.sh` | utility | — | No codegen scripts exist in the repo; placeholder only |
| `native/flutter/lib/main.dart` (full app version) | config/entry | — | Existing stub is counter demo; no real Flutter app entry exists yet |
| Dart ARB files (`l10n/app_zh.arb`, `l10n/app_en.arb`) | config | transform | No ARB files anywhere in repo; use flutter gen-l10n convention from RESEARCH.md |

---

## Metadata

**Analog search scope:** `apps/web/src/`, `packages/protocol/src/`, `native/flutter/`
**Files read:**
- `packages/protocol/src/index.ts` — protocol types source of truth
- `apps/web/src/main.tsx` — Relay state machine + SessionList + SessionCard behavioral reference
- `apps/web/src/contexts/auth-context.tsx` — auth flow and token validation pattern
- `apps/web/src/lib/api.ts` — API client and token header patterns
- `apps/web/src/i18n/messages.ts` — zh/en string pairs to mirror
- `apps/web/src/pages/session-control-page.tsx` — terminal control page entry
- `apps/web/src/pages/session-replay-page.tsx` — replay page entry
- `apps/web/src/components/session/session-surface.tsx` — terminal surface types and mode pattern
- `native/flutter/lib/main.dart` — existing Flutter stub (replace)
- `native/flutter/pubspec.yaml` — existing minimal pubspec (extend)
**Pattern extraction date:** 2026-05-04
