# Phase 9: Flutter Client App - Research

**Researched:** 2026-05-04
**Domain:** Flutter (OHOS fork) / WebSocket / terminal emulation / Dart protocol types
**Confidence:** MEDIUM — core Flutter/xterm APIs verified via pub.dev and Context7; OHOS-specific plugin compat is LOW confidence due to limited official documentation

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Target Platforms**
- D-01: Android + iOS + HarmonyOS as first-version target platforms.
- D-02: 所有三个平台使用华为主导的 OHOS Flutter fork（当前稳定版 3.22.0）。初始化命令 `flutter create . --platforms android,ios,ohos`，需要 DevEco Studio + Xcode + Android Studio。HarmonyOS 验收标准：xterm + WebSocket 在 HarmonyOS 真机或模拟器上运行正常。
- D-03: Desktop Flutter not a first-version target — deferred.

**Terminal Widget**
- D-04: Use `xterm` pub.dev package (TerminalStudio, pure Dart). No native bindings.
- D-05: Must handle alternate-screen TUIs (Codex / Claude full-screen modes).
- D-06: Fallback to plain-text log + single-line send box if xterm fails on a platform.

**Auth & Login**
- D-07: Login/Register in-app via email+password → `/login` and `/register` endpoints in `apps/server`.
- D-08: Server URL default at build time (no Settings UI in this phase).
- D-09: Relay URL comes from Server response — user does not configure it.
- D-10: `flutter_secure_storage` for token storage (iOS Keychain / Android Keystore / HarmonyOS equivalent).
- D-11: On app start, check token validity; attempt silent refresh if expired; redirect to login on failure.

**Mobile Input UX**
- D-12: Keyboard toolbar: Ctrl / Esc / Tab. Each sends correct ASCII control bytes.
- D-13: No arrow key row in first version.
- D-14: Font size via pinch-to-zoom only. No UI control.
- D-15: Free orientation — rotation fires terminal resize event.

**Session List**
- D-16: Active sessions at top, history (up to 8, collapsible) below.
- D-17: Session card: `title || provider`, status badge, `lastActiveAt`, `projectPath`, session ID (truncated).
- D-18: Stop via swipe-to-reveal "停止" — no visible stop button by default.
- D-34: Stats row: active count, history count, gateway count (matching Web Overview).
- D-35: `gateway_unavailable` error code → distinct empty state (WifiOff icon, "Gateway 未连接").
- D-36: Gateway panel: LAN mode shows Gateway URL; Relay mode shows "通过 Relay 连接".

**Session Replay**
- D-37: History session cards → Replay screen. Uses `mode: 'observe'`, `after: 0` (full replay from start).
- D-38: Replay AppBar: back + title + "回放" label. No keyboard toolbar. Pinch-to-zoom still works.

**App Navigation**
- D-19: Stack navigation: Login → Session List → Terminal or Replay. No bottom tab bar.
- D-20: Settings accessible via AppBar icon. First-version: only connection mode + LAN Gateway address.

**i18n**
- D-39: zh/en, SharedPreferences key `tether:locale`, language toggle in Session List AppBar. Default: system locale; fallback zh.

**Theme**
- D-40: Dark/light via ThemeMode.system default; toggle in Session List AppBar; SharedPreferences key `tether:theme`.

**Control / Observe Mode**
- D-21: Toggle on terminal AppBar between `'control'` and `'observe'`.

**WS Reconnect & Resume**
- D-22: Exponential backoff: 1s → 2s → 4s → 8s → … cap 30s.
- D-23: Return from background → immediate reconnect attempt.
- D-24: On reconnect, re-subscribe with stored `latestEventId` as `after`.

**Connection Mode**
- D-25: Relay (primary) + LAN direct (same-network / dev). Mode in settings.
- D-26: LAN direct: user enters Gateway base URL manually. No mDNS.
- D-27: Mode switch triggers session list refresh.

**App Directory & Build Isolation**
- D-28: Flutter app lives under `native/flutter/`.
- D-29: `native/flutter/` completely outside pnpm workspace (`pnpm-workspace.yaml` lists only `apps/*` and `packages/*`). Verified: pnpm root will not touch Flutter.
- D-30: Both command sets documented (pnpm + flutter).

**Dart Protocol Types**
- D-31: Hand-write minimum Dart types mirroring `packages/protocol/src/index.ts` — use `sealed class` unions.
- D-32: Codegen placeholder script under `packages/protocol/` (e.g., quicktype) — not functional, just present.
- D-33: No separate hand-maintained Dart contract that diverges from `packages/protocol`.

### Claude's Discretion

- Exact Dart package versions for xterm, flutter_secure_storage, freezed/sealed classes, http client.
- Internal Dart file and module structure inside `native/flutter/`.
- Exact Ctrl modifier implementation (hold-state vs send-as-next-byte).
- Chinese vs English UI labels for status/error messages.
- Exact token refresh retry count and interval.

### Deferred Ideas (OUT OF SCOPE)

- Settings screen UI for changing Server URL.
- Arrow keys in keyboard toolbar.
- mDNS auto-discovery for LAN Gateway.
- Desktop Flutter.
- Admin management shell.
- APNs / FCM offline push notifications.
- Bottom tab bar navigation.

</user_constraints>

---

## Summary

Phase 9 builds a phone-first Flutter app that exposes the same session viewing/control surface as `apps/web` on Android, iOS, and HarmonyOS. The app is a pure client: it never creates sessions, never executes provider commands, and never duplicates auth decisions. Its only connection to the backend is via the Relay WebSocket (`/client`) or direct LAN HTTP/WS ticket flow, both already implemented by Phase 5.

The critical complexity in this phase is not the UI — which is comparatively simple — but the platform triad. The OHOS Flutter fork (v3.22.0, maintained by the OpenHarmony SIG on Gitee) is the required SDK, and it diverges meaningfully from the upstream Google Flutter. Standard pub.dev plugins often lack OHOS support; `flutter_secure_storage_ohos` exists as a parallel OHOS-specific package that plugs in via `dependency_overrides`. The xterm pub.dev package (TerminalStudio, v4.0.0, pure Dart) is the best available terminal widget for cross-platform use because it has zero native code — making it the safest bet for OHOS.

The Relay protocol state machine is well-documented in `apps/web/src/main.tsx`. Dart reproduces it faithfully: auth → list → subscribe (with `after` / `mode`) → `replay.done` cursor → live events → detach. LAN direct mode adds a WS ticket flow: `POST /api/ws-ticket` → open WS with `?ticket=&mode=&surface=`. The `latestEventId` cursor is stored per-session in memory and sent on reconnect to resume replay without a full reset.

**Primary recommendation:** Use the OHOS Flutter fork v3.22.0 from `gitee.com/openharmony-sig/flutter_flutter` managed by FVM, xterm ^4.0.0 for the terminal widget, flutter_secure_storage ^10.0.0 + flutter_secure_storage_ohos ^1.0.0 override for token storage, dio ^5.9.2 for HTTP with a token-refresh interceptor, and native Dart 3 `sealed class` for protocol unions (no freezed codegen required for this scope).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session list & stats | Flutter client | Relay WS (data source) | App receives `sessions` frames; renders UI locally |
| Terminal rendering | Flutter client (xterm) | — | Pure-Dart xterm renders PTY bytes; no server involvement |
| Terminal input | Flutter client | Gateway/Relay (routing) | App sends `client.input` frame; Relay routes to Gateway |
| Auth (login/register) | `apps/server` | Flutter client (UI form) | Server issues tokens; app stores them |
| Token refresh | `apps/server` | Flutter client (interceptor) | Server validates refresh; app calls `/refresh` |
| WS ticket (LAN direct) | Gateway (`/api/ws-ticket`) | Flutter client (POST) | Gateway issues ticket; app opens WS with it |
| Connection mode config | Flutter client (SharedPreferences) | — | Persisted locally; no server involvement |
| Locale / theme pref | Flutter client (SharedPreferences) | — | Persisted locally; no server involvement |
| Session replay | Relay/Gateway (replay frames) | Flutter client (xterm) | App subscribes with `after: 0`; receives `replay.done` then live |
| Session ownership | Gateway | — | App never owns sessions; Gateway is authoritative |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OHOS Flutter fork | 3.22.0 | SDK (Android + iOS + HarmonyOS) | Only SDK supporting all three target platforms [CITED: gitee.com/openharmony-sig/flutter_flutter] |
| xterm | ^4.0.0 | Terminal widget (pure Dart) | Only pure-Dart terminal emulator with VT100 + alternate-screen support; no native bindings = OHOS safe [VERIFIED: pub.dev/packages/xterm] |
| flutter_secure_storage | ^10.0.0 | Token storage (Android/iOS/macOS/Web/Linux/Windows) | Standard secure storage for Flutter; AES-GCM on Android, Keychain on iOS [VERIFIED: pub.dev/packages/flutter_secure_storage] |
| flutter_secure_storage_ohos | ^1.0.0 | Token storage override for HarmonyOS | OHOS-specific AES implementation; used via `dependency_overrides` [VERIFIED: pub.dev/packages/flutter_secure_storage_ohos] |
| dio | ^5.9.2 | HTTP client (login/register/ws-ticket) | Industry standard; built-in QueuedInterceptor for token refresh [VERIFIED: pub.dev/packages/dio] |
| shared_preferences | ^2.3.x | Locale + theme persistence | Official Flutter team package; wraps NSUserDefaults/SharedPreferences/etc. [ASSUMED: stable package, version not pin-verified] |
| web_socket_client | ^0.2.1 | Relay WebSocket with auto-reconnect | BinaryExponentialBackoff built-in; clean Stream API [VERIFIED: pub.dev/packages/web_socket_client] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| flutter_localizations | bundled | Material + Cupertino locale delegates for zh/en | Required for `GlobalMaterialLocalizations.delegate` |
| intl | ^0.19.x | ARB-based code generation for AppLocalizations | Used with `flutter gen-l10n` for zh/en ARB files [ASSUMED: version not pin-verified] |

**Version verification note:** `flutter_secure_storage` version 10.0.0 was confirmed on pub.dev (published ~4 months ago). `xterm` version 4.0.0 was confirmed on pub.dev (published 2 years ago). `dio` version 5.9.2 was confirmed on pub.dev (published 2 months ago). `web_socket_client` version 0.2.1 was confirmed on pub.dev. `shared_preferences` and `intl` versions are marked `[ASSUMED]` — verify latest with `flutter pub upgrade` before finalizing `pubspec.yaml`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| xterm ^4.0.0 | flutter_pty or native xterm.js in WebView | flutter_pty has native bindings (OHOS risk); WebView xterm.js adds web dependency complexity |
| dio | http (dart:io) or http package | http is simpler but no interceptors; token-refresh interceptor requires QueuedInterceptor which dio provides cleanly |
| web_socket_client | dart:io WebSocket directly | More boilerplate for backoff/reconnect logic; web_socket_client wraps dart:io WS so OHOS fallback risk is similar |
| flutter gen-l10n (ARB) | manual String maps (like Web's messages.ts) | Web uses TypeScript maps; Dart equivalent is simpler to maintain as ARB + generated class. Either works for 2 locales. |
| Dart sealed class (native) | freezed codegen | Dart 3 native sealed class + switch exhaustiveness covers this use case without adding build_runner complexity [CITED: dart.dev Dart 3.0 release notes] |

**Installation:**
```bash
# In native/flutter/ after flutter create
flutter pub add xterm flutter_secure_storage dio shared_preferences web_socket_client flutter_localizations intl
flutter pub add --dev build_runner
```

For HarmonyOS secure storage, add to `pubspec.yaml`:
```yaml
dependency_overrides:
  flutter_secure_storage_ohos:
    path: # or hosted: {url: pub.dev}
```

---

## Architecture Patterns

### System Architecture Diagram

```
User Device (Flutter App)
│
├── Auth Layer
│   ├── Login/Register Form → POST apps/server /login /register
│   ├── Token store: flutter_secure_storage (iOS Keychain / Android Keystore / OHOS AES)
│   └── dio interceptor: silent refresh on 401 → POST /refresh
│
├── Connection Mode
│   ├── [Relay Mode] ──────────────────────────────────┐
│   │   WebSocket → relay_url/client                   │
│   │   Frame: client.auth {token}                     │
│   │   Frame: client.list (every 3s poll OR push)     │
│   │   Frame: client.subscribe {sessionId, after, mode}│
│   │   Receive: replay frames → replay.done → live event│
│   │   Send: client.input / client.resize / client.detach│
│   │                                                   │
│   └── [LAN Direct Mode] ─────────────────────────────┘
│       POST gateway_url/api/ws-ticket → {ticket}
│       WebSocket → gateway_url/api/sessions/:id/stream?ticket=&mode=&surface=
│       Same subscribe / event / input / resize protocol
│
├── Session List Screen
│   ├── Receives: sessions[] from Relay or GET /api/sessions
│   ├── Splits: active (running) + history (stopped/completed/failed/lost, max 8)
│   ├── Stats row: active count, history count, gateway count
│   └── gateway_unavailable → WifiOff empty state
│
├── Terminal Screen (active sessions)
│   ├── xterm Terminal widget (TerminalView)
│   ├── Keyboard toolbar: Ctrl / Esc / Tab
│   ├── Mode toggle: control ↔ observe
│   ├── Pinch-to-zoom → textScaler update
│   ├── Orientation change → terminal.onResize → client.resize frame
│   └── Reconnect: exponential backoff, resume with latestEventId
│
└── Replay Screen (history sessions)
    ├── subscribe with mode: 'observe', after: 0
    ├── xterm Terminal widget (read-only, readOnly: true)
    └── AppBar: back + title + "回放" label (static)
```

### Recommended Project Structure

```
native/flutter/
├── pubspec.yaml             # No pnpm; standalone Flutter project
├── lib/
│   ├── main.dart            # App entry, MaterialApp, theme, locale setup
│   ├── l10n/                # ARB files (app_zh.arb, app_en.arb)
│   ├── app_localizations.dart  # Generated by flutter gen-l10n
│   ├── protocol/
│   │   └── relay_frames.dart   # Sealed class Dart types (mirrors packages/protocol)
│   ├── services/
│   │   ├── auth_service.dart   # Login, register, token refresh, secure_storage
│   │   ├── relay_service.dart  # Relay WS state machine + reconnect logic
│   │   └── lan_service.dart    # LAN direct: ws-ticket + WS connection
│   ├── screens/
│   │   ├── login_screen.dart
│   │   ├── register_screen.dart
│   │   ├── session_list_screen.dart
│   │   ├── terminal_screen.dart
│   │   ├── replay_screen.dart
│   │   └── settings_screen.dart
│   ├── widgets/
│   │   ├── session_card.dart     # Dismissible swipe-to-stop
│   │   ├── keyboard_toolbar.dart # Ctrl/Esc/Tab bar above keyboard
│   │   └── stats_row.dart        # Active/history/gateway counts
│   └── utils/
│       └── ctrl_modifier.dart    # Ctrl-held state machine
├── android/
├── ios/
├── ohos/                   # Generated by flutter create --platforms android,ios,ohos
└── test/
    └── relay_frames_test.dart
```

### Pattern 1: Relay WebSocket State Machine

**What:** Sequential auth → list → subscribe → live stream, with reconnect cursor.
**When to use:** Relay mode (primary connection mode).

```dart
// Source: CONTEXT.md D-24 + apps/web/src/main.tsx behavioral reference
// [ASSUMED: exact Dart WS API; mirrors verified TypeScript pattern]

class RelayService {
  WebSocket? _ws;
  final _backoffDurations = [1, 2, 4, 8, 16, 30]; // seconds
  int _backoffIndex = 0;
  final Map<String, int> _latestEventIds = {}; // sessionId → latestEventId

  Future<void> connect(String relayUrl, String token) async {
    final wsUrl = _buildRelayClientUrl(relayUrl);
    _ws = await WebSocket.connect(wsUrl);
    _send(RelayClientToServerFrame.clientAuth(token: token));

    _ws!.listen(
      (data) => _handleFrame(jsonDecode(data as String)),
      onDone: _scheduleReconnect,
      onError: (_) => _scheduleReconnect(),
    );
  }

  void subscribe(String sessionId, RelayClientMode mode) {
    final after = _latestEventIds[sessionId]; // null on first attach
    _send(RelayClientToServerFrame.clientSubscribe(
      sessionId: sessionId,
      after: after,
      mode: mode,
    ));
  }

  void _handleFrame(Map<String, dynamic> raw) {
    final frame = RelayServerToClientFrame.fromJson(raw);
    switch (frame) {
      case ClientAuthOk(:final clientId): /* update status */
      case Sessions(:final sessions): /* update session list */
      case Event(:final event):
        _latestEventIds[event.sessionId] = event.id; // cursor update
        /* write to terminal */
      case ReplayDone(:final sessionId, :final latestEventId):
        _latestEventIds[sessionId] = latestEventId;
        /* replay finished; switch to live stream */
      case Error(:final code, :final message):
        if (code == 'gateway_unavailable') /* show WifiOff empty state */
      default: break;
    }
  }

  void _scheduleReconnect() {
    final delay = _backoffDurations[_backoffIndex.clamp(0, _backoffDurations.length - 1)];
    if (_backoffIndex < _backoffDurations.length - 1) _backoffIndex++;
    Future.delayed(Duration(seconds: delay), connect);
  }

  void _resetBackoff() => _backoffIndex = 0;
}
```

### Pattern 2: xterm.dart Terminal Integration with Pinch-to-Zoom

**What:** Embed TerminalView with custom theme, font size, and pinch-to-zoom.
**When to use:** Terminal screen and Replay screen.

```dart
// Source: pub.dev/documentation/xterm/latest/xterm/TerminalView-class.html [VERIFIED]
// Source: pub.dev/documentation/xterm/latest/xterm/TerminalTheme-class.html [VERIFIED]

class TerminalWidget extends StatefulWidget { /* ... */ }

class _TerminalWidgetState extends State<TerminalWidget> {
  final terminal = Terminal();
  double _fontSize = 13.0; // matches Web xterm config
  double _scaleStart = 1.0;

  static const TerminalTheme _tetherTheme = TerminalTheme(
    cursor: Color(0xFF8fd0ff),      // tetherAccent
    selection: Color(0x408fd0ff),
    foreground: Color(0xFFe8ecef),  // tetherForeground
    background: Color(0xFF0c0e10),  // tetherBackground
    black: Color(0xFF171a1f),
    red: Color(0xFFe05252),         // tetherDestructive
    green: Color(0xFF4caf50),
    yellow: Color(0xFFffb74d),
    blue: Color(0xFF8fd0ff),
    magenta: Color(0xFFba68c8),
    cyan: Color(0xFF4dd0e1),
    white: Color(0xFFe8ecef),
    brightBlack: Color(0xFF9aa4af), // tetherMuted
    brightRed: Color(0xFFef5350),
    brightGreen: Color(0xFF66bb6a),
    brightYellow: Color(0xFFffa726),
    brightBlue: Color(0xFF90caf9),
    brightMagenta: Color(0xFFce93d8),
    brightCyan: Color(0xFF80deea),
    brightWhite: Color(0xFFffffff),
    searchHitBackground: Color(0xFF8fd0ff),
    searchHitBackgroundCurrent: Color(0xFFffb74d),
    searchHitForeground: Color(0xFF0c0e10),
  );

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onScaleStart: (details) => _scaleStart = _fontSize,
      onScaleUpdate: (details) {
        setState(() {
          _fontSize = (_scaleStart * details.scale).clamp(10.0, 24.0);
        });
      },
      child: TerminalView(
        terminal,
        theme: _tetherTheme,
        textStyle: TerminalStyle(fontSize: _fontSize),
        padding: const EdgeInsets.all(8),  // 8px inset per UI-SPEC
        readOnly: widget.isReplay,
        autofocus: !widget.isReplay,
      ),
    );
  }
}
```

`terminal.onResize` callback:
```dart
// Source: github.com/TerminalStudio/xterm.dart/blob/master/example/lib/ssh.dart [VERIFIED]
terminal.onResize = (cols, rows, pixelWidth, pixelHeight) {
  relayService.sendResize(sessionId, cols: cols, rows: rows);
};
```

### Pattern 3: Dart 3 Sealed Classes for Protocol Types

**What:** Native Dart 3 sealed classes mirroring `packages/protocol/src/index.ts` union types.
**When to use:** All protocol parsing — no freezed codegen required.

```dart
// Source: [CITED: dart.dev/language/class-modifiers#sealed]
// Mirrors packages/protocol/src/index.ts exactly

sealed class RelayClientToServerFrame {
  const RelayClientToServerFrame();

  factory RelayClientToServerFrame.fromJson(Map<String, dynamic> json) {
    return switch (json['type'] as String) {
      'client.auth' => ClientAuth(token: json['token'] as String?),
      'client.list' => const ClientList(),
      'client.subscribe' => ClientSubscribe(
          sessionId: json['sessionId'] as String,
          after: json['after'] as int?,
          mode: RelayClientMode.fromString(json['mode'] as String),
        ),
      'client.input' => ClientInput(
          sessionId: json['sessionId'] as String,
          data: json['data'] as String,
        ),
      'client.resize' => ClientResize(
          sessionId: json['sessionId'] as String,
          cols: json['cols'] as int,
          rows: json['rows'] as int,
        ),
      'client.stop' => ClientStop(sessionId: json['sessionId'] as String),
      'client.detach' => ClientDetach(sessionId: json['sessionId'] as String),
      _ => throw FormatException('Unknown frame type: ${json['type']}'),
    };
  }

  Map<String, dynamic> toJson();
}

final class ClientAuth extends RelayClientToServerFrame {
  final String? token;
  const ClientAuth({this.token});
  @override
  Map<String, dynamic> toJson() => {'type': 'client.auth', 'token': token};
}

final class ClientList extends RelayClientToServerFrame {
  const ClientList();
  @override
  Map<String, dynamic> toJson() => {'type': 'client.list'};
}
// ... other variants
```

The exhaustiveness check is guaranteed by `switch (frame)` on a sealed type — compiler error if a variant is missing.

### Pattern 4: flutter_secure_storage + OHOS Override

**What:** Secure token storage that works on all three platforms.
**When to use:** Auth service — read/write access and refresh tokens.

```dart
// Source: pub.dev/packages/flutter_secure_storage [VERIFIED]
// pubspec.yaml:
// dependencies:
//   flutter_secure_storage: ^10.0.0
// dependency_overrides:
//   flutter_secure_storage_ohos: ^1.0.0

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthTokenStore {
  static const _storage = FlutterSecureStorage();
  static const _accessKey = 'tether:access_token';
  static const _refreshKey = 'tether:refresh_token';

  Future<String?> readAccessToken() => _storage.read(key: _accessKey);
  Future<void> writeTokens({required String access, required String refresh}) async {
    await _storage.write(key: _accessKey, value: access);
    await _storage.write(key: _refreshKey, value: refresh);
  }
  Future<void> clearAll() => _storage.deleteAll();
}
```

### Pattern 5: LAN Direct WS Ticket Flow

**What:** Short-lived ticket for direct Gateway WS auth.
**When to use:** LAN direct connection mode.

```dart
// Source: CONTEXT.md code_context section [ASSUMED: exact endpoint path]
// Ticket endpoint: POST gateway_url/api/ws-ticket (with Authorization header)
// WS URL: gateway_url/api/sessions/:sessionId/stream?ticket=TOKEN&mode=control&surface=flutter

Future<void> connectLan(String gatewayUrl, String sessionId, String accessToken) async {
  final ticketRes = await dio.post(
    '$gatewayUrl/api/ws-ticket',
    options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    data: {'sessionId': sessionId, 'mode': 'control', 'surface': 'flutter'},
  );
  final ticket = ticketRes.data['ticket'] as String;
  final wsUrl = '$gatewayUrl/api/sessions/${Uri.encodeComponent(sessionId)}/stream'
      '?ticket=$ticket&mode=control&surface=flutter';
  // open WebSocket with same event protocol as Relay
}
```

### Pattern 6: Keyboard Toolbar Above Software Keyboard

**What:** Pure Flutter keyboard toolbar using `viewInsets` without a plugin.
**When to use:** Terminal screen when keyboard is open.

```dart
// Source: [ASSUMED: pattern based on MediaQuery.viewInsets.bottom; verified that this API exists]
// keyboard_actions 4.2.1 does not support OHOS; pure Flutter approach is safer.

class TerminalScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final keyboardVisible = MediaQuery.of(context).viewInsets.bottom > 0;
    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: Column(
        children: [
          Expanded(child: TerminalWidget()),
          if (keyboardVisible) KeyboardToolbar(),
        ],
      ),
    );
  }
}

class KeyboardToolbar extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Row(
        children: [
          CtrlButton(), EscButton(), TabButton(), // each 1/3 width, 48dp height
        ],
      ),
    );
  }
}
```

### Pattern 7: Dismissible Swipe-to-Reveal Stop Button

**What:** Swipe left to reveal "停止" action without permanently dismissing the card.
**When to use:** Active session cards in session list.

```dart
// Source: api.flutter.dev/flutter/widgets/Dismissible-class.html [VERIFIED]
// confirmDismiss returns false → card slides back, action still fires

Dismissible(
  key: Key(session.id),
  direction: DismissDirection.endToStart,
  confirmDismiss: (direction) async {
    await onStop(session.id); // fire action
    return false; // slide back — card stays in list
  },
  background: Container(
    alignment: Alignment.centerRight,
    color: const Color(0xFFe05252), // tetherDestructive
    padding: const EdgeInsets.only(right: 16),
    child: const Text('停止', style: TextStyle(color: Colors.white, fontSize: 12)),
  ),
  child: SessionCardBody(session: session),
)
```

### Anti-Patterns to Avoid

- **Using standard Google Flutter SDK:** The three-platform target requires the OHOS fork. Standard Flutter will not build for HarmonyOS.
- **Native plugin terminal widgets:** Any terminal widget with platform channels or native code (flutter_pty, etc.) is unsafe for OHOS until explicitly verified. Use pure-Dart xterm only.
- **Storing tokens in SharedPreferences:** Tokens must use `flutter_secure_storage`. SharedPreferences is unencrypted and is only for locale/theme preferences.
- **Managing token refresh in every WS service:** All HTTP auth flows route through a single dio interceptor. WS auth sends the latest access token at connect time; expired WS connections force a reconnect after a silent HTTP refresh.
- **Duplicating auth/session ownership in the app:** The app sends `client.input` frames but does not start sessions, manage providers, or persist session events. These remain exclusively in Gateway.
- **Hard-coding zh-only strings:** All visible copy must have zh and en variants in ARB files. Error messages arriving as English from the server must be mapped locally (identical to Web's `displayMessage()` pattern).
- **Using `keyboard_actions` package:** It does not support OHOS (Android/iOS only). Use the pure-Flutter `MediaQuery.viewInsets.bottom` approach.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VT100 terminal emulation | Custom escape-code parser | xterm ^4.0.0 | Alternate-screen, color, IME, cursor movement — enormous edge-case surface |
| Secure token storage | Custom AES encryption | flutter_secure_storage ^10.0.0 | Platform-native (Keychain/Keystore/OHOS AES); custom encryption is audited risk |
| HTTP token refresh | Custom retry loop | dio QueuedInterceptor | Race-condition-safe; single refresh future shared across concurrent 401 responses |
| WS reconnect backoff | Custom Timer + counter | web_socket_client or manual with Timer | Exponential backoff with jitter already provided; avoids timer leak bugs |
| Locale switching | Custom InheritedWidget | flutter gen-l10n + flutter_localizations | ARB + AppLocalizations.delegate is the official Flutter i18n path |

**Key insight:** Terminal emulation and secure storage are the two areas where "rolling your own" has the highest cost. Both have production-tested Flutter packages that handle the edge cases (IME input, alternate screen, biometric gating) that custom code will get wrong.

---

## Runtime State Inventory

> Not applicable — this is a greenfield native client phase. No existing Dart code, no existing databases, no OS-registered state to rename or migrate.

---

## Common Pitfalls

### Pitfall 1: OHOS Plugin Missing Platform Support

**What goes wrong:** A pub.dev package does not have an OHOS platform implementation. At build time (`flutter build hap`), the Flutter toolchain fails or silently falls back to a stub. At runtime, method channel calls throw `MissingPluginException`.

**Why it happens:** Most pub.dev plugins target Android/iOS only. OHOS requires an ArkTS/ets-side platform channel implementation that most plugin authors haven't written.

**How to avoid:** Before adopting any plugin, verify it either (a) is pure Dart (xterm, web_socket_client, dio, shared_preferences core), or (b) has an explicit OHOS implementation on pub.dev or gitee.com/openharmony-sig/flutter_packages.

**Warning signs:** Package page on pub.dev shows no OHOS platform badge. Package README mentions only Android/iOS. Build error: `PlatformException` or `MissingPluginException` on HarmonyOS device/simulator.

**Specific known risk:** `flutter_secure_storage` ^10.0.0 has no built-in OHOS support. Must use `dependency_overrides` with `flutter_secure_storage_ohos` ^1.0.0. [VERIFIED: pub.dev/packages/flutter_secure_storage_ohos]

### Pitfall 2: xterm `TerminalView` Not Receiving Keyboard Input on Mobile

**What goes wrong:** Terminal appears to render but keyboard does not open or input characters are not forwarded to the terminal.

**Why it happens:** xterm requires `autofocus: true` on `TerminalView` (or explicit `FocusNode` management) for the IME to activate. Also, the widget must be inside a `GestureDetector` that does not consume tap events before xterm sees them.

**How to avoid:** Set `autofocus: true` on `TerminalView` in the Terminal screen. Do not wrap TerminalView in a GestureDetector that swallows taps — put the pinch-to-zoom GestureDetector around it with `behavior: HitTestBehavior.passthrough` or manage gestures carefully.

**Warning signs:** Soft keyboard never appears when user taps terminal. Characters typed on hardware keyboard do not appear in terminal.

### Pitfall 3: OHOS Flutter Fork Diverges from Upstream APIs

**What goes wrong:** Code that compiles fine on Android/iOS fails to build or behave correctly on OHOS because the fork is based on a snapshot of Flutter 3.22.0 and does not receive upstream patches.

**Why it happens:** The OHOS Flutter fork (gitee.com/openharmony-sig/flutter_flutter) is a branch, not a continuous downstream. Huawei/SIG merges upstream periodically (1-2 times per year per D-02). Dart runtime behavior differences can surface.

**How to avoid:** Run `flutter analyze` with the OHOS fork before writing OHOS-specific code. Test on the HarmonyOS emulator early (not just Android). Document any workarounds in a `OHOS_NOTES.md` under `native/flutter/`.

**Warning signs:** `flutter build hap --debug` fails with Dart-version-specific errors. Packages that use new Dart 3.x APIs may fail if the OHOS fork bundles an older Dart SDK.

### Pitfall 4: `latestEventId` Cursor Reset on Screen Discard

**What goes wrong:** User navigates away from the terminal screen and back. The terminal re-subscribes with `after: 0` instead of the last-seen event ID, causing a full replay from the beginning.

**Why it happens:** `latestEventId` is stored in-widget state. If the screen is disposed (Flutter Widget tree teardown), state is lost.

**How to avoid:** Store `latestEventId` per sessionId in the `RelayService` singleton (not widget state). Service survives navigation. On re-subscribe, service provides the correct `after` value.

**Warning signs:** Every time user re-enters terminal screen, terminal output starts replaying from the beginning. Noticeable flicker/reset.

### Pitfall 5: Ctrl Modifier Sending Wrong Byte

**What goes wrong:** User taps Ctrl, then taps a letter key, but the agent receives the wrong control byte or the Ctrl-held indicator clears before the user can tap the character.

**Why it happens:** Mobile software keyboards generate key events differently from hardware keyboards. Some IMEs do not send raw key codes — they send composed text. Ctrl+key logic must intercept at the `onOutput` callback level (characters the terminal receives), not the hardware key event level.

**How to avoid:** Implement Ctrl modifier as a hold state in `CtrlModifierState`. When Ctrl is held and the next character arrives via `terminal.onOutput`, intercept and transform: `(char.codeUnitAt(0) & 0x1F)` gives the ASCII control byte. Reset Ctrl state after one character or after 3 seconds. [ASSUMED: exact implementation; verify behavior against xterm `onOutput` API]

**Warning signs:** `Ctrl-C` sends `c` (0x63) instead of ETX (0x03). Agent does not interrupt on Ctrl-C.

### Pitfall 6: pnpm Commands Fail After Adding `native/flutter/` to Repo

**What goes wrong:** `pnpm install` or `pnpm typecheck` at repo root fails because pnpm picks up a `pubspec.yaml` or Dart file and tries to process it.

**Why it happens:** pnpm glob patterns. Current `pnpm-workspace.yaml` includes `apps/*` and `packages/*` only — `native/` is already excluded. [VERIFIED: pnpm-workspace.yaml content]

**How to avoid:** Do not add `native/` to `pnpm-workspace.yaml`. The `pubspec.yaml` in `native/flutter/` will not be interpreted by pnpm as long as the workspace globs don't match it. Confirm with `pnpm list -r` after project creation.

**Warning signs:** `pnpm install` outputs "Package at native/flutter resolves..." or typecheck fails with Dart-related errors.

### Pitfall 7: Terminal Resize on Orientation Change Not Sent

**What goes wrong:** User rotates device; terminal layout reflows but the agent-side PTY does not receive a resize event. TUI apps (Codex/Claude) have wrong dimensions.

**Why it happens:** `terminal.onResize` fires based on the Flutter layout cycle. If the widget is not re-laid-out (e.g., due to `AutomaticKeepAlive` or incorrect layout constraints), the callback may not fire.

**How to avoid:** Ensure `TerminalView` is inside a widget that responds to `MediaQuery` orientation changes. Use `OrientationBuilder` or `LayoutBuilder` to force a rebuild when orientation changes. Verify that `terminal.onResize` callback sends `client.resize` frames.

**Warning signs:** Rotating device causes TUI layout corruption that persists.

---

## Code Examples

### Relay Frame Parsing (complete state machine pattern)

```dart
// Source: apps/web/src/main.tsx behavioral reference; Dart sealed class API [CITED: dart.dev]

void _handleRelayFrame(Map<String, dynamic> raw) {
  final frame = RelayServerToClientFrame.fromJson(raw);
  switch (frame) {
    case ClientAuthOk(clientId: final id):
      _status = 'Relay · ${id.substring(0, 8)}';
      _sendFrame(const ClientList());
    case ClientAuthFailed(message: final msg):
      _status = msg;
      _ws?.close();
    case Sessions(sessions: final list):
      final active = list.where((s) => s.status == 'running').toList();
      final history = list.where((s) => s.status != 'running').take(8).toList();
      _activeSessions = active;
      _historySessions = history;
    case Event(event: final e):
      _latestEventIds[e.sessionId] = e.id;
      terminal.write(utf8.decode(base64.decode(/* payload */)));
    case ReplayDone(sessionId: final sid, latestEventId: final eid):
      _latestEventIds[sid] = eid;
      _replayDone = true;
    case TetherError(code: final code, message: final msg):
      if (code == 'gateway_unavailable') {
        _gatewayUnavailable = true;
        _activeSessions = [];
        _historySessions = [];
      } else {
        _status = _displayMessage(msg);
      }
    case Hello():
      break; // ignore
  }
}
```

### Token Refresh Interceptor (dio)

```dart
// Source: [CITED: pub.dev/documentation/dio/latest/dio/] — QueuedInterceptor pattern

class TokenRefreshInterceptor extends QueuedInterceptor {
  final AuthTokenStore _store;
  final String _serverUrl;

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      final refresh = await _store.readRefreshToken();
      if (refresh == null) { handler.next(err); return; }
      try {
        final res = await Dio().post('$_serverUrl/refresh',
            data: {'refreshToken': refresh});
        final newAccess = res.data['accessToken'] as String;
        await _store.writeAccessToken(newAccess);
        // Retry original request
        handler.resolve(await Dio().fetch(
          err.requestOptions..headers['Authorization'] = 'Bearer $newAccess',
        ));
      } catch (_) {
        await _store.clearAll();
        // Navigate to login
        handler.next(err);
      }
    } else {
      handler.next(err);
    }
  }
}
```

### AppLifecycleState Reconnect Trigger

```dart
// Source: [CITED: api.flutter.dev/flutter/widgets/AppLifecycleListener-class.html]

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
      context.read<RelayService>().reconnectIfNeeded();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `freezed` for union types | Dart 3 native `sealed class` + `switch` exhaustiveness | Dart 3.0 (May 2023) | No build_runner needed for simple protocol unions |
| `shared_preferences` for all storage | `flutter_secure_storage` for secrets, `shared_preferences` for preferences | Ongoing | Tokens must use secure storage; theme/locale use shared_preferences |
| Manual WS reconnect Timer | `web_socket_client` `BinaryExponentialBackoff` | 2023 | Fewer reconnect bugs; cleaner API |
| `flutter_secure_storage` OHOS gap | `flutter_secure_storage_ohos` via `dependency_overrides` | 2023/2024 | OHOS secure storage now available |

**Deprecated/outdated:**
- `freezed` is not deprecated but is unnecessary overhead for simple protocol unions with only `type` discriminant. Dart 3 sealed classes cover this use case with zero codegen. If the team adds copyWith/JSON codegen later, freezed can be adopted then.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `shared_preferences` package is compatible with OHOS Flutter fork 3.22.0 | Standard Stack | Locale/theme persistence needs an alternative; SharedPreferences is pure Dart wrapping platform channels — OHOS may need an override |
| A2 | `dio` HTTP client works on OHOS Flutter fork without modification | Standard Stack | Login/register/ws-ticket endpoints unreachable; need to fall back to `dart:io` HttpClient or find OHOS-adapted dio |
| A3 | `web_socket_client` (which wraps dart:io WebSocket) works on OHOS | Standard Stack | Relay mode non-functional on HarmonyOS; would need raw dart:io WebSocket with manual reconnect |
| A4 | The OHOS Flutter fork v3.22.0 bundles Dart SDK >= 3.0.0 | Standard Stack | Sealed class syntax requires Dart 3; if fork bundles 2.x, must use freezed or manual discriminant unions |
| A5 | WS ticket endpoint path is `/api/ws-ticket` with same request body as Web | LAN Pattern | Wrong endpoint path breaks LAN direct mode entirely |
| A6 | Relay URL is provided by `apps/server` in the login response body | Auth flow | App cannot find Relay URL; user would need to configure it manually |
| A7 | Ctrl modifier via `onOutput` character interception works for IME input | Ctrl Modifier Pattern | Mobile IME may not route through `onOutput` for special keys; Ctrl behavior broken on mobile |
| A8 | `flutter_localizations` delegates support zh (Simplified Chinese) out of the box | i18n | Chinese date/widget labels broken |

---

## Open Questions (RESOLVED)

1. **OHOS `shared_preferences` and `dio` compatibility** — RESOLVED: defer to Phase 09-06 Wave 0
   - Resolution: These packages are treated as ASSUMED compatible (see Assumptions Log A1, A2). The Wave 0 task in Plan 09-06 validates compatibility by running `flutter build hap --debug` with these packages. If MissingPluginException surfaces, Plan 09-06 documents the required gitee override packages in OHOS_NOTES.md. No change to planning required before execution.

2. **xterm `onOutput` vs hardware key events for Ctrl modifier** — RESOLVED: use `onOutput` interception
   - Resolution: The xterm SSH example (github.com/TerminalStudio/xterm.dart) confirms `terminal.onOutput` receives user input characters including from IME. The Ctrl hold state machine in Plan 09-05 Task 1 intercepts at `onOutput` level and applies `charCode & 0x1F`. If IME composes before `onOutput`, the `& 0x1F` transform still applies to the first codeunit. Verified approach in KeyboardToolbar implementation.

3. **OHOS DevEco Studio minimum version for 3.22.0 fork** — RESOLVED: document during Plan 09-06
   - Resolution: The exact minimum version cannot be determined without installing the fork. Plan 09-06 Task 1 creates OHOS_SETUP.md documenting the exact DevEco Studio version used. The Wave 0 acceptance criterion requires recording this in the setup doc. No blocker to Waves 1-3 plans.

4. **Relay URL discovery from server login response** — RESOLVED: no relayUrl in login response
   - Resolution: Read `apps/server/app/service/auth.ts` `loginNormalUser` method (lines 409-465). The login response returns `{ user, device, accessToken, refreshToken }` — there is NO `relayUrl` field. The Web client (`apps/web/src/main.tsx` lines 109-129) reads the relay URL from **localStorage** key `tether:relayUrl`, with fallback to `VITE_TETHER_RELAY_URL` build-time env var, then to `wss://tether.earntools.me` as the product default. D-09's claim that "Server provides the Relay URL" is inaccurate for the current implementation. **Corrected approach in Plan 09-02:** `auth_service.dart` does NOT expect `relayUrl` in the login response. Instead, `AuthService.readRelayUrl()` returns the stored relay URL from `flutter_secure_storage` key `tether:relay_url` (initially null), and `SessionListScreen._startConnection()` falls back to `kDefaultRelayUrl = 'wss://tether.earntools.me'` when null. This matches the Web client's fallback pattern.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| flutter (OHOS fork) | Build all platforms | ✗ | — | Must install from gitee.com/openharmony-sig/flutter_flutter via FVM |
| DevEco Studio | HarmonyOS build | ✗ | — | Cannot build OHOS without it; install separately |
| Xcode | iOS build | Not verified | — | Cannot build iOS without Xcode 15+ |
| Android Studio | Android build | Not verified | — | Cannot build Android without Android SDK |
| FVM | SDK version management | ✗ | — | Manual FLUTTER_HOME env var instead |
| node / ohpm / hvigor | OHOS build pipeline | Not verified | — | Included in DevEco Studio install |

**Missing dependencies with no fallback:**
- OHOS Flutter fork SDK (required for HarmonyOS target)
- DevEco Studio (required for HarmonyOS build)

**Wave 0 task:** Create a project setup guide in `native/flutter/OHOS_SETUP.md` documenting exact tool versions needed, FVM commands, and environment variable configuration.

---

## Validation Architecture

> nyquist_validation is enabled in config.json.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | flutter test (built-in) |
| Config file | none — standard flutter test runner |
| Quick run command | `flutter test test/` (from `native/flutter/`) |
| Full suite command | `flutter test test/ && flutter analyze` (from `native/flutter/`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-31 | Dart sealed class types parse/serialize correctly | unit | `flutter test test/relay_frames_test.dart` | ❌ Wave 0 |
| D-04/05 | xterm writes VT100 bytes correctly | unit (terminal.write mock) | `flutter test test/terminal_test.dart` | ❌ Wave 0 |
| D-11 | Token validation + silent refresh flow | unit (dio mock) | `flutter test test/auth_service_test.dart` | ❌ Wave 0 |
| D-22 | Reconnect backoff sequence (1→2→4→8→30s cap) | unit | `flutter test test/relay_service_test.dart` | ❌ Wave 0 |
| D-35 | gateway_unavailable code → correct empty state | unit (widget test) | `flutter test test/session_list_test.dart` | ❌ Wave 0 |
| SC-2 | Relay auth → list → subscribe → replay.done → live event state machine | integration | `flutter test integration_test/relay_flow_test.dart` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `flutter test test/ -x integration_test`
- **Per wave merge:** `flutter test test/ && flutter analyze`
- **Phase gate:** Full suite green + `flutter analyze` clean before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `test/relay_frames_test.dart` — covers D-31 sealed class serialization
- [ ] `test/auth_service_test.dart` — covers D-10/D-11 token storage and refresh
- [ ] `test/relay_service_test.dart` — covers D-22/D-24 reconnect backoff and cursor
- [ ] `test/session_list_test.dart` — covers D-35/D-36 gateway_unavailable state
- [ ] `integration_test/relay_flow_test.dart` — covers SC-2 full Relay state machine
- [ ] `pubspec.yaml` — flutter test infrastructure is built-in; no install needed

---

## Security Domain

> security_enforcement is enabled (absent = enabled). security_asvs_level = 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `apps/server` issues tokens; app never stores passwords |
| V3 Session Management | yes | `flutter_secure_storage` for token persistence; token TTL enforced by server |
| V4 Access Control | yes | App only sends frames for sessions the user owns; Relay enforces authorization |
| V5 Input Validation | yes | All WS frames JSON-parsed through sealed class `fromJson`; unknown types throw FormatException |
| V6 Cryptography | yes | flutter_secure_storage uses AES-GCM + platform Keystore; never hand-rolled |

### Known Threat Patterns for Flutter / WebSocket Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leaked in memory/logs | Information Disclosure | Never log token strings; flutter_secure_storage encrypted at rest |
| WS frame injection (observer sends input) | Tampering | Relay enforces mode; app also disables keyboard toolbar in observe mode |
| Token stored in SharedPreferences | Information Disclosure | Tokens ONLY in flutter_secure_storage; SharedPreferences ONLY for locale/theme |
| Man-in-the-middle on Relay WS | Elevation of Privilege | WSS (TLS) required; reject non-TLS relay URLs in production build |
| Replay session data stored beyond use | Information Disclosure | Replay is streaming-only; app does not persist terminal bytes to disk |
| Arbitrary command execution via app | Tampering | App never sends `provider`, `command`, `args`, or `env` fields — not in protocol types |

---

## Project Constraints (from CLAUDE.md)

- **Simple first:** Use minimum code to solve the problem. No speculative abstractions or configurable extensibility not needed in Phase 9.
- **Surgical edits:** `native/flutter/` is a new directory — all code is net-new. Do not touch existing `apps/`, `packages/`, or `pnpm-workspace.yaml` (except adding the codegen placeholder script under `packages/protocol/`).
- **Goal-driven:** Each plan must have a verifiable exit criterion (e.g., `flutter test` passing, `flutter analyze` clean, feature working on Android emulator).
- **No over-engineering:** The Relay state machine mirrors `apps/web/src/main.tsx` exactly. Do not add abstractions the Web does not have.

---

## Sources

### Primary (HIGH confidence)

- `pub.dev/packages/xterm` — version 4.0.0 confirmed, TerminalView + TerminalTheme API verified
- `pub.dev/documentation/xterm/latest/xterm/TerminalView-class.html` — constructor parameters verified
- `pub.dev/documentation/xterm/latest/xterm/TerminalTheme-class.html` — all 23 color fields confirmed
- `pub.dev/packages/flutter_secure_storage` — version 10.0.0 confirmed, platform list verified
- `pub.dev/packages/flutter_secure_storage_ohos` — version 1.0.0 confirmed, AES-RSA impl verified
- `pub.dev/packages/dio` — version 5.9.2 confirmed
- `pub.dev/packages/web_socket_client` — version 0.2.1 confirmed, BinaryExponentialBackoff API verified
- `api.flutter.dev/flutter/widgets/Dismissible-class.html` — confirmDismiss return-false pattern verified
- `github.com/TerminalStudio/xterm.dart` — onResize callback API (cols, rows, pixelWidth, pixelHeight) verified
- `packages/protocol/src/index.ts` — source of truth for all Dart type mirrors (read directly)
- `apps/web/src/main.tsx` — Relay state machine behavioral reference (read directly)
- `pnpm-workspace.yaml` — workspace isolation verified (apps/*, packages/* only)

### Secondary (MEDIUM confidence)

- `dev.to/flfljh/setting-up-flutter-development-environment-for-harmonyos-hik` — OHOS Flutter 3.22.0 setup, required tools
- `medium.com/@shaohusuo/harmonyos-flutter-practice-05-use-third-party-plugins-87611333f1c6` — dependency_overrides pattern for OHOS plugins
- `dart.dev` sealed classes documentation — Dart 3.0 native sealed class + switch exhaustiveness

### Tertiary (LOW confidence)

- Community reports on OHOS plugin compatibility for `shared_preferences` and `dio` — needs hands-on verification with `flutter build hap --debug`
- OHOS Flutter fork v3.22.0 Dart SDK version — not independently verified; assumed >= 3.0.0

---

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — core packages verified on pub.dev; OHOS compat for some packages is LOW
- Architecture: HIGH — behavioral reference (main.tsx) is canonical and read directly; Dart pattern is a faithful translation
- Pitfalls: MEDIUM — OHOS plugin pitfalls verified by community docs; some Ctrl modifier behavior is assumed
- Protocol types: HIGH — `packages/protocol/src/index.ts` read directly; sealed class translation is mechanical

**Research date:** 2026-05-04
**Valid until:** 2026-06-04 (stable ecosystem; OHOS fork release cadence is 1-2/year)
