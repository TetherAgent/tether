# Phase 9: Flutter Client App - Context

**Gathered:** 2026-05-02
**Updated:** 2026-05-08 — 主视图改为 chat，导航改为 Bottom Tab Bar，键盘工具栏推迟，LAN 直连移除
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase builds a phone-first Flutter client that lets users remotely view and take over existing Gateway-owned agent sessions via Relay. The app targets Android, iOS, and HarmonyOS (via flutter_ohos). The primary surface is a chat bubble view (matching the H5 ChatSessionSurface), with terminal as a secondary/toggle view. The app is a pure client surface: it does not own sessions, start providers, duplicate Gateway auth logic, or make Relay an ownership authority.

</domain>

<decisions>
## Implementation Decisions

### Target Platforms
- **D-01:** The Flutter app must support Android, iOS, and HarmonyOS as first-version target platforms.
- **D-02:** 所有三个平台（Android、iOS、HarmonyOS）使用**同一个 SDK**：华为主导的 OHOS Flutter fork（当前稳定版 3.22.0，年发 1-2 版，不是标准 Google Flutter）。初始化命令：`flutter create . --platforms android,ios,ohos`，需要 DevEco Studio + Xcode + Android Studio。SDK 锁定在 fork 版本，不跟主线 Flutter 自动升级。HarmonyOS 验收标准：chat 视图 + WebSocket 在 HarmonyOS 真机或模拟器上运行正常；不要求与 iOS/Android 在所有边缘情况下完全对齐。
- **D-03:** Desktop Flutter is not a first-version target. Deferred.

### Primary Surface: Chat View
- **D-04a:** The primary session view is a **chat bubble interface** matching the H5 `ChatSessionSurface` — structured assistant/user turns, tool cards, typing indicator, activity bubble, select options, unread scroll FAB. Reference: `apps/web/src/components/session/chat-session-surface.tsx`.
- **D-04b:** Chat view is the default when entering a session. Terminal view is a secondary tab the user can switch to.

### Secondary Surface: Terminal Widget
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
- **D-12:** ~~Keyboard toolbar (Ctrl/Esc/Tab)~~ — **DEFERRED.** Not in this phase.
- **D-13:** ~~Arrow key row~~ — **DEFERRED.**
- **D-14:** Font size: pinch-to-zoom gesture inside the terminal widget. The user can scale font size by pinching.
- **D-15:** Screen orientation: free rotation. Both portrait and landscape are supported. Rotating triggers a terminal resize event.

### Session List
- **D-16:** Session list screen shows two sections: active sessions (running) at top, history (stopped/completed/failed/lost, up to 8) below as a collapsible section — same structure as Web end.
- **D-17:** Each session card shows: `title || provider` (same fallback as Web), status badge, lastActiveAt timestamp, projectPath, and session ID (truncated, same as Web card). Matches Web `SessionCard` display fields exactly.
- **D-18:** Stop a session: swipe the session card to reveal a "停止" action button. No stop button visible by default. This is the mobile-appropriate equivalent of the Web's AlertDialog confirm-stop flow; no additional confirmation dialog required.
- **D-34:** Session list screen shows a summary stats row at the top: active session count, history count, and gateway count — matching the Web Overview metrics panel (`Activity`, `Clock3`, `Router` icons). In Relay mode, gateway count shows "Relay" label same as Web.
- **D-35:** `gateway_unavailable` error state: when Relay returns `error.code === 'gateway_unavailable'`, the empty state shows a disconnected icon + "Gateway 未连接" heading + "Gateway 尚未连接到 Relay，请先启动 tether gateway。" body — matching Web's distinct `WifiOff` + `t.gatewayNotConnected` / `t.relayGatewayUnavailableDescription` state.
- **D-36:** Gateway panel: in direct (LAN) mode, show a gateway info section below the stats row displaying Gateway URL. In Relay mode, show "通过 Relay 连接" label. Matches Web's gateway panel behavior.

### Session Replay
- **D-37:** History session cards navigate to a Replay screen instead of the Terminal control screen. Tap a history card → push Replay screen. Replay screen shows the terminal in read-only playback mode using the same `client.subscribe` protocol with `mode: 'observe'` and `after: 0` (full replay from start). Matches Web's `SessionReplayPage` behavior.
- **D-38:** Replay screen AppBar shows: back arrow + session title/provider + "回放" label (non-interactive, replaces the control/observe toggle). No keyboard toolbar in replay mode. Pinch-to-zoom still works.

### App Navigation
- **D-19:** **Bottom Tab Bar 导航**（变更自原先的纯堆栈）。登录后进入主 Shell，底部 Tab Bar 包含主要分区（会话列表、设置等）。会话列表 → 进入 Session 后在会话内部用 Tab 或 Toggle 在 Chat / Terminal 之间切换。Back 手势返回会话列表。
- **D-20:** Settings 通过底部 Tab Bar 中的设置 Tab 访问。Server URL 默认值固定，UI 配置推迟；本期仅需支持连接模式切换（已简化为 Relay only，无 LAN 选项）。

### i18n
- **D-39:** The app supports Simplified Chinese and English, same as Web. Language preference is persisted in SharedPreferences (key: `tether:locale`). A language toggle is accessible from the Session List AppBar (icon button). All visible copy must have both zh and en variants. Default locale follows system locale; falls back to zh if system locale is not en.

### Theme
- **D-40:** The app supports dark and light themes, same as Web. Theme preference is persisted in SharedPreferences (key: `tether:theme`). A theme toggle is accessible from the Session List AppBar. Default follows system theme (`ThemeMode.system`).

### Control / Observe Mode
- **D-21:** Toggle button at the top of the terminal screen to switch between control and observe mode. Shows current mode clearly. Matches the same protocol semantics as the Web end (`client.subscribe` with `mode: 'control' | 'observe'`).

### WS Reconnect & Resume
- **D-22:** Auto-reconnect on WebSocket disconnect with exponential backoff: 1s → 2s → 4s → 8s → … up to 30s ceiling.
- **D-23:** When the app returns from background, immediately trigger a reconnect attempt.
- **D-24:** On reconnect, resume the terminal session subscription using `latestEventId` (stored in memory for the current app session). The Gateway/Relay replays missed events from `after=latestEventId`. The terminal display continues without a full reset.

### Connection Mode
- **D-25:** **仅 Relay 模式**（变更）。本期只实现 Relay 远程连接，LAN 直连不做。
- **D-26:** ~~LAN direct URL 手动填写~~ — **REMOVED.**
- **D-27:** ~~连接模式切换触发会话列表刷新~~ — **REMOVED.**（只有一种模式，无需切换）

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
- `apps/web/src/main.tsx` — Complete Web client implementation: Relay auth flow, session list, control/observe mode, replay cursor, client.subscribe/input/resize/detach frames. Flutter must match this behavior.
- `apps/web/src/components/session/chat-session-surface.tsx` — **Primary reference for Flutter chat view.** Bubble layout, tool cards, typing indicator, activity states, select options, unread scroll FAB, draft persistence, history navigation. Flutter chat view replicates this behavior.
- `apps/web/src/components/session/chat-bubble.tsx` — ChatBubble and ChatThinkingBubble components (status ticks, folded rows, cancel generation).
- `apps/web/src/components/session/chat-markdown.tsx` — Markdown + code block rendering reference.

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
- **Chat bubble view is the primary session surface** — matches H5 ChatSessionSurface.
- Terminal view (xterm pub.dev) is secondary, accessible via in-session toggle/tab.
- xterm pub.dev (TerminalStudio) is the terminal widget — not WebView + xterm.js.
- Token storage: flutter_secure_storage, not SharedPreferences.
- Server URL: default at build time, configurable in device settings, UI deferred. Server auto-provides Relay URL.
- **Navigation: Bottom Tab Bar** (不再是纯堆栈).
- Session stop: swipe-to-reveal, not a visible button on card.
- **Connection: Relay only** — no LAN direct mode.
- **Keyboard toolbar: DEFERRED.**

</specifics>

<deferred>
## Deferred Ideas

- Settings screen UI for changing Server URL — functional default exists, UI change deferred to a later phase.
- Keyboard toolbar (Ctrl/Esc/Tab) — deferred from Phase 9; not in first version.
- Arrow keys (↑↓←→) in keyboard toolbar — deferred.
- LAN direct connection (manual IP entry) — deferred; Relay only in Phase 9.
- mDNS auto-discovery for LAN Gateway — deferred.
- Desktop Flutter — deferred unless it falls out naturally from the mobile build.
- Admin management shell — Phase 6 Web-only feature, not in Flutter scope.
- APNs / FCM offline push notifications — deferred per PROJECT.md (PUSH-01 is v2).

</deferred>

---

*Phase: 9-Flutter Client App*
*Context gathered: 2026-05-02*
*Updated: 2026-05-04 — feature alignment with Web; added D-34~D-40 (stats, gateway panel, gateway_unavailable, replay, i18n, theme)*
