# Phase 9: Flutter Client App - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase builds a phone-first Flutter client that lets users remotely view and take over existing Gateway-owned agent sessions. The app supports Relay remote connection and LAN Gateway direct connection. It targets Android, iOS, and HarmonyOS (via flutter_ohos). The app is a pure client surface: it does not own sessions, start providers, duplicate Gateway auth logic, or make Relay an ownership authority.

</domain>

<decisions>
## Implementation Decisions

### Target Platforms
- **D-01:** The Flutter app must support Android, iOS, and HarmonyOS as first-version target platforms.
- **D-02:** 所有三个平台（Android、iOS、HarmonyOS）使用**同一个 SDK**：华为主导的 OHOS Flutter fork（当前稳定版 3.22.0，年发 1-2 版，不是标准 Google Flutter）。初始化命令：`flutter create . --platforms android,ios,ohos`，需要 DevEco Studio + Xcode + Android Studio。SDK 锁定在 fork 版本，不跟主线 Flutter 自动升级。HarmonyOS 验收标准：xterm + WebSocket 在 HarmonyOS 真机或模拟器上运行正常；不要求与 iOS/Android 在所有边缘情况下完全对齐。
- **D-03:** Desktop Flutter is not a first-version target. Deferred.

### Terminal Widget
- **D-04:** Use the `xterm` pub.dev package (TerminalStudio, pure Dart) as the terminal widget. No native bindings — pure Dart is the best bet for HarmonyOS compatibility.
- **D-05:** The terminal must handle alternate-screen TUIs (Codex / Claude full-screen modes). xterm pub.dev supports VT100/ANSI including alternate screen.
- **D-06:** Fallback: if xterm fails to render correctly on a platform, degrade to a plain-text terminal.output log + single-line send box. This fallback is the worst-case floor, not the target. It must be documented in CONTEXT.md if hit.

### Auth & Login
- **D-07:** Login in-app via email + password form, identical semantics to the Web `/login` endpoint in `apps/server`. Register also in-app via the same `/register` endpoint.
- **D-08:** Server URL has a built-in default (configurable constant in app code). The user can change it in device settings. A settings UI for changing the Server URL is **not built in this phase** — it is a deferred item. The default value is fixed at build time.
- **D-09:** Server provides the Relay URL automatically after login. Users do not configure Relay URL separately — it comes from the Server response or a known path from the Server URL.
- **D-10:** Tokens (access token + refresh token) are stored with `flutter_secure_storage` (iOS Keychain / Android Keystore / HarmonyOS equivalent). Not SharedPreferences — the app uses secure storage from the first version.
- **D-11:** On app start, check stored token validity. If expired, attempt silent refresh. If refresh fails, redirect to login screen.

### Mobile Input UX
- **D-12:** Show a keyboard toolbar above the software keyboard when the terminal is active. The toolbar contains: **Ctrl**, **Esc**, **Tab**. Each button sends the correct ASCII control byte to the terminal stream (Ctrl → holds Ctrl modifier for next key; Esc → 0x1B; Tab → 0x09).
- **D-13:** No arrow key row in the toolbar for the first version.
- **D-14:** Font size: pinch-to-zoom gesture inside the terminal widget. The user can scale font size by pinching.
- **D-15:** Screen orientation: free rotation. Both portrait and landscape are supported. Rotating triggers a terminal resize event.

### Session List
- **D-16:** Session list screen shows two sections: active sessions (running) at top, history (stopped/completed/failed/lost, up to 8) below as a collapsible section — same structure as Web end.
- **D-17:** Each session card shows: provider name, status label, lastActiveAt timestamp, projectPath.
- **D-18:** Stop a session: swipe the session card to reveal a "停止" action button. No stop button visible by default.

### App Navigation
- **D-19:** Stack navigation: Login → Session List → Terminal screen. Back button / back gesture from Terminal returns to Session List. No bottom tab bar in the first version.
- **D-20:** Settings (Server URL, connection mode, LAN Gateway address) is accessible via a settings entry in the navigation bar of the Session List screen. Settings screen UI is deferred for most fields — only connection mode and LAN Gateway address are needed for first-version functionality.

### Control / Observe Mode
- **D-21:** Toggle button at the top of the terminal screen to switch between control and observe mode. Shows current mode clearly. Matches the same protocol semantics as the Web end (`client.subscribe` with `mode: 'control' | 'observe'`).

### WS Reconnect & Resume
- **D-22:** Auto-reconnect on WebSocket disconnect with exponential backoff: 1s → 2s → 4s → 8s → … up to 30s ceiling.
- **D-23:** When the app returns from background, immediately trigger a reconnect attempt.
- **D-24:** On reconnect, resume the terminal session subscription using `latestEventId` (stored in memory for the current app session). The Gateway/Relay replays missed events from `after=latestEventId`. The terminal display continues without a full reset.

### Connection Mode
- **D-25:** Two connection modes: **Relay** (primary) and **LAN direct** (same-network / dev). Mode is set in the settings screen.
- **D-26:** LAN direct: user manually enters the Gateway base URL (e.g., `http://192.168.1.x:4789`) in settings. No mDNS auto-discovery in this version.
- **D-27:** Switching connection mode in settings triggers a session list refresh on return to the list screen.

### App Directory & Build Isolation
- **D-28:** The Flutter app lives under `native/flutter/` — matching the existing `native/README.md` convention.
- **D-29:** `native/flutter/` is completely outside the pnpm workspace. Running `pnpm typecheck` or `pnpm test` at repo root must not touch Flutter. Flutter validation runs separately: `flutter analyze` and `flutter test` from `native/flutter/`.
- **D-30:** CONTEXT.md documents both command sets so CI or developers know to run both.

### Dart Protocol Types
- **D-31:** First version: hand-write the minimum Dart types that mirror `packages/protocol/src/index.ts` — specifically `RelayClientToServerFrame`, `RelayServerToClientFrame`, `RelaySession`, `RelayTerminalEvent`. Use `sealed class` / `freezed`-style unions.
- **D-32:** A codegen placeholder script lives under `packages/protocol/` to generate Dart types in the future (e.g., via quicktype). It does not need to be functional in Phase 9 — just present as a documented next step.
- **D-33:** There must be no separate hand-maintained Dart contract that diverges from `packages/protocol`. The hand-written types in Phase 9 are a temporary bridge; the placeholder script is the exit ramp.

### Claude's Discretion
- Exact Dart package versions for `xterm`, `flutter_secure_storage`, `freezed` or sealed classes, and http client.
- Internal Dart file and module structure inside `native/flutter/`.
- Exact Ctrl modifier implementation (hold-state vs send-as-next-byte).
- Chinese vs English UI labels (user mentioned Chinese UI elsewhere, but no explicit call for this in Flutter — planner may default to Chinese for status/error messages matching Web end).
- Exact token refresh retry count and interval.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and Architecture
- `.planning/ROADMAP.md` — Phase 9 entry, success criteria, and dependency on Phase 8.
- `.planning/PROJECT.md` — Product positioning, permanent out-of-scope boundaries, safety constraints, and Core Value statement.
- `.planning/REQUIREMENTS.md` — Active auth, Relay, audit, and security requirements the Flutter app must not bypass.
- `AI_CONTEXT.md` — Long-term architecture: Flutter/HarmonyOS/iOS/Android are client surfaces consuming Gateway/Relay protocol.
- `native/README.md` — Native client rules, reserved directory structure, and out-of-pnpm-workspace convention.

### Protocol and Client Boundaries
- `packages/protocol/src/index.ts` — Source of truth for `RelayClientToServerFrame`, `RelayServerToClientFrame`, `RelaySession`, `RelayTerminalEvent`, `RelayAuthScope`. Dart types must match these exactly.
- `packages/core/src/index.ts` — Shared provider names, Gateway identity, and UI surface kinds.

### Auth Contract (Phase 5)
- `.planning/phases/05-web-first-account-setup-server-auth-runtime/05-CONTEXT.md` — Token model decisions: access token, refresh token, 30-day validity, `flutter_secure_storage`-equivalent for Web is `localStorage` (pragmatic), Server issues tokens, Relay validates them.

### Web Client (Feature Reference)
- `apps/web/src/main.tsx` — Complete Web client implementation: Relay auth flow, session list, PTY terminal view, control/observe mode, replay cursor, client.subscribe/input/resize/detach frames. Flutter must match this behavior.

### Codebase Maps
- `.planning/codebase/STACK.md` — Current TypeScript/pnpm stack and reserved `native/flutter/` area.
- `.planning/codebase/ARCHITECTURE.md` — Gateway/Relay/Web architecture and client anti-patterns to avoid.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/protocol/src/index.ts`: Wire types to mirror in Dart — `RelayClientToServerFrame` (6 variants), `RelayServerToClientFrame` (7 variants), `RelaySession`, `RelayTerminalEvent`, `RelayAuthScope`. This is the complete Dart SDK surface.
- `apps/web/src/main.tsx`: Full Relay client state machine (auth → list → subscribe → replay → live stream → detach). Flutter must reproduce this flow. The Web implementation is the canonical behavioral reference.
- `native/flutter/`: Empty placeholder, no existing Dart code.

### Established Patterns
- Relay auth sequence: `client.auth(token)` → `client.auth.ok` → `client.list` → `client.subscribe(sessionId, after, mode)` → `replay.done` → live `event` frames. Flutter must implement this exact sequence.
- `latestEventId` cursor: stored per-session, sent as `after` on subscribe, updated on each incoming event. Enables seamless reconnect and replay. Flutter stores this in memory per-session (for the current app session).
- WS ticket pattern (LAN direct): `POST /api/ws-ticket` → open WS with `?ticket=&mode=&surface=`. Flutter reproduces this for LAN mode.
- Session status labels and client mode semantics are shared across Web and Flutter — same string values (`'control'`, `'observe'`, `'running'`, `'stopped'`, etc.).

### Integration Points
- `native/flutter/` for app code and Dart SDK package.
- `packages/protocol` as upstream source for Dart type generation.
- `apps/server` `/login` and `/register` endpoints for auth.
- Gateway direct HTTP/WS endpoints for LAN mode (`/api/sessions`, `/api/ws-ticket`, `/api/sessions/:id/stream`).
- Relay `/client` WebSocket for remote mode.

</code_context>

<specifics>
## Specific Ideas

- Three platforms: Android, iOS, HarmonyOS — all first-version targets.
- Toolbar keys: Ctrl, Esc, Tab (not arrow keys). Exactly these three.
- xterm pub.dev (TerminalStudio) is the terminal widget — not WebView + xterm.js.
- Token storage: flutter_secure_storage, not SharedPreferences.
- Server URL: default at build time, configurable in device settings, UI deferred. Server auto-provides Relay URL.
- Navigation: pure stack, no bottom tabs.
- Session stop: swipe-to-reveal, not a visible button on card.
- LAN: manual IP entry, no mDNS.

</specifics>

<deferred>
## Deferred Ideas

- Settings screen UI for changing Server URL — functional default exists, UI change deferred to a later phase.
- Arrow keys (↑↓←→) in keyboard toolbar — users can add via system keyboard; deferred from Phase 9 toolbar.
- mDNS auto-discovery for LAN Gateway — deferred; manual IP entry is sufficient for first version.
- Desktop Flutter — deferred unless it falls out naturally from the mobile build.
- Admin management shell — Phase 6 Web-only feature, not in Flutter scope.
- APNs / FCM offline push notifications — deferred per PROJECT.md (PUSH-01 is v2).
- Bottom tab bar navigation — deferred; stack nav is sufficient for first version.

</deferred>

---

*Phase: 9-Flutter Client App*
*Context gathered: 2026-05-02*
