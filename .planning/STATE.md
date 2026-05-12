---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: in_progress
stopped_at: Completed 18-03-PLAN.md
last_updated: "2026-05-12T11:23:17Z"
last_activity: 2026-05-12 -- Quick 260512-qte complete
progress:
  total_phases: 18
  completed_phases: 11
  total_plans: 69
  completed_plans: 69
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-01)

**Core value:** 在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、手机/Web/App 接入上超越 tmux。
**Current focus:** Phase 18 — sqlite

## Current Position

Phase: 18
Plan: complete
Next: none
Last activity: 2026-05-12 -- Phase 18 plan 03 complete

Progress: [██████████] 100%

## Quick Tasks Completed

| Date | Quick ID | Task | Summary |
|------|----------|------|---------|
| 2026-05-12 | 260512-qte | Gateway runtime split Wave 1 | Extracted `RelaySender` for Gateway outgoing relay frames; see `.planning/quick/260512-qte-docs-working-2026-05-12-gateway-runtime-/260512-qte-SUMMARY.md`. |
| 2026-05-11 | 260511-gd9 | Chat session title ownership | Added `title_source` protection so Web-renamed chat titles are not overwritten by Gateway runtime sync; see `.planning/quick/260511-gd9-docs-working-2026-05-11-chat-session-tit/260511-gd9-SUMMARY.md`. |

## Performance Metrics

**Velocity:**

- Total plans completed: 26
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03 | 4 | - | - |
| 3 | 4 | - | - |
| 04 | 1 | - | - |
| 4 | 1 | - | - |
| 16 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 11 P01 | 6 min | 2 tasks | 3 files |
| Phase 11 P02 | 7min | 2 tasks | 5 files |
| Phase 11 P03 | 4min | 2 tasks | 3 files |
| Phase 11 P04 | 8min | 3 tasks | 12 files |
| Phase 14 P01 | 16min | 1 tasks | 1 files |
| Phase 14 P02 | 18min | 2 tasks | 6 files |
| Phase 14 P03 | 24min | 3 tasks | 4 files |
| Phase 14 P04 | 15min | 2 tasks | 2 files |
| Phase 14 P05 | 45min | 2 tasks | 2 files |
| Phase 14 P06 | 30min | 2 tasks | 4 files |
| Phase 18 P01 | 22min | 3 tasks | 14 files |
| Phase 18 P02 | 9min | 4 tasks | 14 files |
| Phase 18 P03 | 16min | 2 tasks | 23 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 2 shipped: PTY-backed event stream (TRANSPORT-01..04, CLI-01/02, MULTI-01, WEB-01, REPLAY-01, SAFE-01..03, STATE-01, STRUCT-01) — all validated
- v0.3 scope has changed to Multi-account Relay Access: account login, Gateway startup auth, Relay Gateway/Client WS auth, ownership, roles, revoke, and audit are now in scope
- Relay MVP is Phase 1: self-hosted Relay, Gateway outbound WSS, owner link secret, one Gateway + remote Web client; this remains a bootstrap path only, not the target auth model
- Supervisor/launchd was pulled forward and completed as a foundation capability for Gateway persistence; it no longer occupies an active roadmap phase number
- Normal roadmap now resumes at Phase 4 account/auth contract, then Phase 5 Web-first account setup/auth runtime, Phase 6 account management console, Phase 7 retention, and Phase 8 security/isolation tests
- Phase 4 is a short no-code contract gate: it must define account/workspace/Gateway/session ownership, user/device identity, roles, token classes, sharing/control semantics, revoke, and audit before Phase 5 implementation starts
- Phase 5 is Web-first Account Setup & Server Auth Runtime: it should add `apps/server`, `/register`, `/login`, `/admin/register`, `/admin/login`, Gateway login/bind, Relay auth/role/audit runtime only, not the full account management UI
- Phase 6 is Account Management Console: workspace/member/role/device/Gateway/revoke/audit administration belongs there
- Dedicated Server decision: account registration, login, token issuance/refresh/revoke, Gateway registration/binding, Relay authorization checks, and audit ingestion belong in remote `apps/server`; Relay stays routing-only and Gateway stays local session owner
- First account creation decision: first owner creation is normal Web registration in `apps/web` using `/register`; bootstrap-only setup semantics are not part of the required Phase 5 product path, and CLI bootstrap is only emergency/admin recovery, not the primary product path
- Gateway binding decision: `tether gateway login` prompts for account/password in CLI, binds the local Gateway to the account/default workspace, stores/refreshes a Gateway token, and treats expired/revoked/unrefreshable tokens as logged out with a clear relogin prompt
- Management identity decision: management console has a separate registration/login flow from normal Web/session users; the first registered management-console account is `super_admin`; management tokens do not automatically grant terminal/session control
- Normal Web user decision: v0.3 normal Web/session users have no role hierarchy; they can access/control their own sessions only. Session sharing roles such as controller/observer and claim-control arbitration are deferred.
- Management role decision: v0.3 management console roles are limited to `super_admin` and `admin`. `super_admin` manages management users and system/security settings; `admin` handles day-to-day normal user/device/Gateway/audit operations only. Additional roles such as auditor/operator/support are deferred.
- Multi-device sync decision: same-user Web/native devices use an authenticated Server notification WebSocket for lightweight metadata and invalidation events. Server pushes session list refresh, session lifecycle, Gateway online/offline, logout, token/device revoke, and auth state changes there; PTY bytes remain on Relay/Gateway session sockets, and APNs/FCM offline push stays deferred.
- Login analytics decision: auth success/failure/logout/refresh and device create/revoke events are first-class audit events. Phase 6 management console shows per-user login counts, last login/failure, active/revoked device counts, and recent auth/security history derived from audit data without storing raw passwords, tokens, or secrets.
- Web UI decision: `apps/web` setup, login, authenticated session shell, and Phase 6 management console should use shadcn as the shared component system
- Workspace decision: v0.3 product UI only exposes one auto-created default workspace per account; schema, token payloads, Gateway binding, session ownership, and audit events must still include `workspaceId`; full multi-workspace creation/switching is deferred to `WORKSPACE-01`
- Detach hotkey: `Ctrl-]` (0x1D, ASCII GS) — CLI-side intercept only, not Gateway-side
- PTY write chunking: 512 bytes per write with `setImmediate` between chunks (macOS PTY 1024-byte buffer bug)
- node-pty must upgrade to ≥ 1.2.0-beta.12 before Phase 5 (GW-01) begins — closes fd-leak issue #907
- Auth pattern: browser WS still uses HTTP token auth to obtain a short-lived one-time WS ticket; token checks must include account/workspace/Gateway/session scope and role
- Token model: client access token, refresh token, Gateway token, device identity, and WS ticket are separate classes; raw long-lived secrets must not be stored in session events or Relay logs
- Retention is now Phase 7: DELETE WHERE ts < cutoff every 15 min; WAL checkpoint (RESTART) on 5-min cadence; no auto-VACUUM
- launchd plist: absolute node path snapshotted at install time via `process.execPath`; `$HOME` not expanded — all paths must be literal strings
- CLEAN-02 decision: retain `transport` column as extension point; remove `'tmux'` from active write types only; keep `'tmux'` in `fromRow` for historical reads
- [Phase 11]: insertConversationTurn returns allocated turn_index — Avoids extra query for downstream caller flow
- [Phase 11]: [Phase 11-02] handleChatMessage returns SessionEvent and callers publish via direct socket or relay gateway.event
- [Phase 11]: JournalWatcher handles Codex completion markers task_completed/task_complete for compatibility. — Design doc and observed logs differ on completion token naming.
- [Phase 11]: agent.turn turnIndex is taken directly from insertConversationTurn return value. — Removes race risk from follow-up list query.
- [Phase 11]: [Phase 11-04] 会话前端统一切到 /chat 路由，移除 /simple 入口
- [Phase 11]: [Phase 11-04] agent.select 检测在 daemon 与 relay-client 两侧独立执行，覆盖直连与中继模式
- [Phase ?]: Phase 18-01: PTY live events now use shared createSessionEvent ids from apps/gateway/src/events.ts instead of store.appendEvent.
- [Phase ?]: Phase 18-01: SessionRunner now sends full SessionEvent payloads over runner sockets because live runner events no longer persist in SQLite.
- [Phase ?]: Phase 18-01: Daemon session lookup now prefers PtySessionManager memory state and falls back to Store for non-PTY sessions.
- [Phase ?]: Phase 18-02: Restored PTY sessions live in a separate restoredSessions map so relay recovery can repopulate metadata without pretending a live local PTY exists.
- [Phase ?]: Phase 18-02: CLI provider launches authenticate to relay with the bound gateway token so local session creation reuses the authenticated gatewayId route.
- [Phase ?]: Phase 18-02: client.new-pty-session carries optional title/providerArgs so the relay path preserves existing CLI launch behavior.
- [Phase ?]: Phase 18-03: Gateway daemon and CLI now rely on PtySessionManager memory state and gateway HTTP only; no local SQLite fallback remains.
- [Phase ?]: Phase 18-03: Replay/history remain intentional stubs after Store removal until a later MySQL-backed replay phase.

### Pending Todos

- Manual Phase 5 verification pending:
  - verify same-user multi-device metadata refresh flow in a live environment

### Roadmap Evolution

- Phase 18 added: 去掉本地 SQLite — PTY 事件走 relay→MySQL，session 元数据改内存 Map，relay 推 gateway.sessions-restore 启动恢复，PTY 创建改 WS 帧；参考 docs/working/2026-05-12-remove-local-sqlite.md
- Phase 9 added: Flutter Client App
- Phase 10 added: Multi-workspace Expansion for WORKSPACE-01; use `$gsd-discuss-phase 10` when ready
- Phase 11 added: Agent 实时对话视图
- Phase 5 complete: Web-first Account Setup & Server Auth Runtime (2026-05-04)
- Phase 6 complete: Account Management Console (2026-05-04, human verified)
- Phase 12 complete: Server DB Runtime Sync (2026-05-09, code verified)
- Phase 13 complete: Mobile Web Chat (2026-05-10, code verified)
- Phase 14 added: Multi-device Gateway Routing — deviceId 绑定、稳定 gatewayId、Gateway 列表 API、Web 选择器、Relay 强制路由；参考 docs/working/2026-05-11-multi-device-gateway-routing.md
- Phase 14 context gathered: 2026-05-11 — 4 个区域讨论完成，CONTEXT.md 已就绪
- Phase 17 added: Chat Multi-client Realtime Sync — 多端同时订阅同一 chat session，按 session 广播 delta/result，Gateway in-flight 锁防并发发送；参考 docs/working/2026-05-11-chat-multi-client-realtime.md
- Phase 17 complete: Relay 多 client chat 广播 + Gateway `chatInFlight` 锁已实现并通过 relay/gateway/web 验证；剩余为 live 双端人工 UAT。

### Blockers/Concerns

- GW-01 probe fallback behavior when Gateway is mid-restart (launchd race) is underspecified in research — recommend a brief design pass before future Gateway hardening. Suggested: retry loop with 3 attempts / 500ms spacing before falling back to in-process.
- Phase 4 must happen before Phase 5. Without a written ownership/token/role/setup/Server contract, Phase 5 auth runtime and Phase 6 management console will likely conflict and require rework.
- Phase 09 build verification is blocked in the current environment: Android Gradle artifact fetch hits TLS/handshake failures, and OHOS packaging requires an external toolchain/manual verification path.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Phase 1.5 | Cloudflare Tunnel / Tailscale tooling | Deferred to v0.4+ | v0.3 scoping |
| Relay hardening | Hosted SaaS operations and E2EE relay envelopes | Deferred after multi-account auth boundary | v0.3 reorder |
| Phase 3a | Provider abstraction (ACP / JSON-RPC) + multi-agent | Deferred | v0.3 scoping |
| Phase 3b | Multi-machine federation | Deferred | v0.3 scoping |
| Phase 3c | Push notifications + encrypted relay | Deferred | v0.3 scoping |
| Phase 4 | Diff / file tree / rich approval UI | Deferred to v1.0+ | v0.3 scoping |
| Workspace expansion | Multi-workspace creation, switching, per-workspace member management | Deferred to Phase 10 / WORKSPACE-01 | Phase 4 discussion |
| Session sharing | controller/observer roles, session sharing invites, and claim-control arbitration | Deferred to SHARING-01 | Phase 4 discussion |
| Terminal view UX | 高级模式（relay）进入页面先 HTTP GET /api/sessions/:id/events 拉历史 events 首屏渲染，WS 建立后以 after=lastEventId 续流实时数据；依赖 Phase 12 Server DB events 接口 | Deferred to post-Phase 12 | Phase 12 discussion |

## Session Continuity

Last session: 2026-05-12T08:19:26Z
Stopped at: Completed 18-03-PLAN.md
Resume file: None
