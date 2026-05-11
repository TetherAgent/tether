# Roadmap: Tether v0.3 — Multi-account Relay Access

## Overview

Finishing milestone: Phase 2 PTY-backed event stream is shipped, and Phase 1 Personal
Relay MVP plus the pulled-forward persistent Gateway supervisor are already complete. The roadmap now treats
the shared-secret Personal Relay path as a temporary bootstrap, not the target security
model. The target is authenticated multi-account remote access: external clients log in,
Gateways authenticate at startup, Relay authenticates both Gateway and client WebSockets,
and every session operation is scoped by account/workspace/Gateway/session ownership.

The safety boundary remains unchanged: Relay forwards authenticated protocol frames only.
It never executes commands, never accepts arbitrary process creation, never becomes the
source of truth for ownership, and never persists terminal plaintext. Account registration,
login, token issuance, Gateway binding, Relay authorization checks, and audit ingestion
belong to a dedicated remote Server service, not to Relay or the local Gateway.
Multi-account auth and the minimum account management console are now in-scope for v0.3;
hosted SaaS billing, advanced organization administration, full E2EE relay envelopes,
federation, and push notifications remain post-v0.3.

Completed foundation: **Supervisor & launchd** was pulled forward and shipped on
2026-05-02. It remains a prerequisite capability for auth/runtime work, but it no longer
occupies an active roadmap phase number.

## Phases

- [x] **Phase 1: Personal Relay MVP** - Gateway connects outbound to a self-hosted Relay; one remote Web client can attach to an existing session
- [ ] **Phase 2: Experience Hardening** - Detach hotkey, key passthrough, paste, ANSI, and TUI resize all verified on macOS
- [x] **Phase 3: Cleanup** - tmux fallback removed; single-transport codebase ready for auth work (completed 2026-05-02)
- [x] **Phase 4: Account & Auth Contract** - Short no-code contract gate for ownership, roles, token classes, Server, Web, Gateway, and Relay boundaries before implementation (completed 2026-05-02)
- [x] **Phase 5: Web-first Account Setup & Server Auth Runtime** - Adds remote `apps/server`, first-owner Web registration, login/token/Gateway binding/Relay auth/role/audit runtime (completed 2026-05-04)
- [x] **Phase 6: Account Management Console** - Web admin surface for workspace members, roles, devices, Gateways, revoke/unlink, and audit visibility (completed 2026-05-04)
- [ ] **Phase 7: Retention** - Event store bounded; WAL checkpoint scheduled; Gateway stable under multi-hour uptime
- [ ] **Phase 8: Security, Isolation Tests & Final Cleanup** - Milestone exit gate; account isolation, relay auth, whitelist, mask, retention all covered by integration tests
- [ ] **Phase 9: Flutter Client App** - Phone-first Flutter client for remote Relay/LAN session viewing and control, with HarmonyOS support and generated Dart protocol
- [ ] **Phase 10: Multi-workspace Expansion** - Product support for creating/switching workspaces, binding Gateways per workspace, and isolating members, sessions, audit, and admin pages by workspace
- [x] **Phase 12: Server DB Runtime Sync** - Web/App 从 Server DB 直接读取 session 列表、聊天历史和受限 Terminal 历史，不再依赖 Gateway 反向 RPC；Relay 实时同步 Gateway frame 到 Server DB (completed 2026-05-09)
- [x] **Phase 13: Mobile Web Chat** - 在 apps/web 中新增类微信三栏聊天界面，通过 Relay WS stream-json 链路创建 AI 会话（Claude/Codex/Copilot）、实时渲染 agent delta、Markdown 渲染、会话历史 HTTP 加载、断线续传 (completed 2026-05-10)
- [ ] **Phase 14: Multi-device Gateway Routing** - 允许同一账号在多台设备上各自绑定稳定 Gateway 记录，Web 显示选择器，Relay 按 gatewayId 严格路由，禁止任何 fallback
- [ ] **Phase 15: Chat Remote Session Metadata** - Chat 链路不再依赖 Gateway 本地 SQLite：Relay 从 Server DB 补齐可信 metadata（provider/projectPath/agentSessionId）后转发给 Gateway，Gateway 直接执行不查本地 sessions

## Phase Details

### Phase 1: Personal Relay MVP
**Goal**: A solo user can run a self-hosted Relay, connect the local Gateway to it over outbound WSS, open the remote Web client, and control an existing PTY session through the relay without exposing the Gateway directly. This phase is complete and now considered a bootstrap path; later phases replace shared-secret auth with account tokens.
**Depends on**: Nothing (PTY event stream already shipped)
**Requirements**: RELAY-01
**Success Criteria** (what must be TRUE):
  1. `apps/relay` exists as a minimal Node/TypeScript service that accepts Gateway and Web client WSS connections using an owner-configured relay link secret
  2. Gateway can start with a relay URL/secret, establish an outbound WSS connection, register its available sessions, and reconnect after transient Relay disconnects
  3. A remote Web client can list and attach to an existing Gateway session through Relay; terminal output, input, resize, and control/observe mode frames round-trip through the relay
  4. Relay only forwards protocol frames between authenticated Gateway/client peers; it never spawns commands, never receives provider command/args/env, and does not persist terminal plaintext
  5. The MVP is explicitly single-owner/single-Gateway oriented as a temporary bootstrap; multi-account auth is implemented by later v0.3 phases
**Plans**:
  - `01-01-PLAN.md` — Relay Protocol Contract
  - `01-02-PLAN.md` — Relay Service Runtime *(depends on Plan 01)*
  - `01-03-PLAN.md` — Gateway Relay Bridge *(depends on Plans 01, 02)*
  - `01-04-PLAN.md` — Web Relay Mode and End-to-End Verification *(depends on Plans 01, 02, 03)*

### Phase 2: Experience Hardening
**Goal**: Local terminal experience is at parity with tmux — detach works, key sequences pass through correctly, paste arrives intact, ANSI renders faithfully, and TUI resize is clean
**Depends on**: Phase 1
**Requirements**: EXP-01, EXP-02, EXP-03, EXP-04, EXP-05
**Success Criteria** (what must be TRUE):
  1. User can press `Ctrl-]` inside `tether attach` to detach without killing the agent; terminal raw mode is fully restored afterward (stty echo set, shell prompt usable)
  2. `Enter`, `Backspace`, `Ctrl-C`, and `Ctrl-D` inside `tether attach` produce the same effect as the same keys in a direct tmux session running the same agent on macOS
  3. Pasting more than 2 KB of text via bracketed paste into `tether attach` delivers the content to the agent intact — no truncation, no corruption from the macOS PTY 1024-byte buffer limit
  4. Codex and Claude TUI full-screen modes (alternate screen, color, cursor movement, clear screen) render without artifacts on both CLI attach and the Web xterm.js client
  5. Resizing the terminal while Codex or Claude is mounted does not leave persistent layout corruption; the agent re-renders cleanly within one frame after resize completes
**Plans**: TBD

### Phase 3: Cleanup
**Goal**: The codebase has a single active transport; tmux code is deleted; the `transport` field is documented as a retained extension point
**Depends on**: Phase 2
**Requirements**: CLEAN-01, CLEAN-02
**Success Criteria** (what must be TRUE):
  1. `tether --transport tmux` (or any equivalent flag) is no longer accepted; the CLI rejects it with a clear error
  2. `apps/gateway/src/tmux.ts` is deleted; `daemon.ts`, `store.ts`, and `apps/cli/src/main.ts` have no tmux-conditional branches
  3. The `transport` column and TypeScript type are retained with a code comment documenting the intent (historical rows readable; future extension point); only `'pty-event-stream'` is valid for new sessions
**Plans**:
  - **Wave 1**:
    - `03-01-PLAN.md` — Store and Protocol Transport Contract
  - **Wave 2** *(blocked on Wave 1 completion)*:
    - `03-02-PLAN.md` — Gateway Runtime tmux Removal *(depends on Plan 01)*
  - **Wave 3** *(blocked on Wave 1 and Wave 2 completion)*:
    - `03-03-PLAN.md` — CLI Transport Simplification *(depends on Plans 01, 02)*
  - **Wave 4** *(blocked on Wave 1, Wave 2, and Wave 3 completion)*:
    - `03-04-PLAN.md` — Web Display, Docs, and End-to-End Cleanup Verification *(depends on Plans 01, 02, 03)*

### Phase 4: Account & Auth Contract
**Goal**: Produce a short executable contract for multi-account auth before implementation. This phase does not change runtime code, database schema, API handlers, Relay behavior, or Web UI.
**Depends on**: Phase 3
**Requirements**: ACCOUNT-01, ACCOUNT-02, ACCOUNT-03, ACCOUNT-04, ACCOUNT-05, SERVER-01, SETUP-01, SETUP-03
**Success Criteria** (what must be TRUE):
  1. A single `ACCOUNT-AUTH-SPEC.md` (or equivalent Phase 4 plan artifact) defines the canonical graph: `account -> workspace -> gateway -> session`, plus `user` and `device`
  2. The contract defines separate management-console accounts and normal Web/session user accounts; the first management-console registration becomes `super_admin`
  3. The contract states normal Web/session accounts have no v0.3 role hierarchy: a normal user can access/control only their own authorized sessions
  4. The contract maps management-console permissions separately: v0.3 management roles are `super_admin` and `admin`; management permissions never automatically grant terminal/session control
  5. The contract defines token classes: normal client access/refresh tokens, management access/refresh tokens, device identity, Gateway token, and short-lived WS ticket
  6. The contract defines same-user multi-device sync through an authenticated Server notification WebSocket for metadata/invalidation events, while terminal PTY bytes stay on Relay/Gateway session sockets
  7. The contract fixes trust boundaries: remote `apps/server` owns accounts, users, devices, Gateway registration, token issuance, refresh, logout, revoke, Relay authorization decisions, notification sync, and audit ingestion; Gateway stores only minimal cached identity/session metadata
  8. The contract documents Relay as a routing layer, not an ownership or execution authority
  9. The contract defines Web-first bootstrap: first-owner registration is completed from Web, management console has separate registration/login, and bootstrap closes once an owner exists; CLI bootstrap is not the normal path
  10. Phase 5 plans reference this contract and may not start until the contract has no unresolved ownership, token, setup, management realm, sync, or role questions
**Plans**:
- `04-01-PLAN.md` — Account Auth Contract Specification

### Phase 5: Web-first Account Setup & Server Auth Runtime
**Goal**: Implement the Phase 4 contract as a complete Web-first account setup and auth runtime. This creates the remote `apps/server` service, adds shadcn-based Web registration/login flows in `apps/web`, authenticates Gateway startup/binding, authorizes Relay/Gateway access, and records identity-bearing audit events. This phase is the "door system", not the full account management console.
**Depends on**: Phase 4
**Requirements**: SERVER-01, SERVER-02, WEBUI-01, SETUP-01, SETUP-02, SETUP-03, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, RELAY-AUTH-01, RELAY-AUTH-02, RELAY-AUTH-03, AUDIT-01, AUDIT-02
**Success Criteria** (what must be TRUE):
  1. `apps/server` exists as the remote source of truth for account, user, workspace, device, Gateway registration, token, authorization, and audit state
  2. `apps/web` includes a shadcn-based `/register` flow that creates the first account/default workspace/owner user/device when no owner exists, while `/setup?token=...` is no longer part of the required product path
  3. `apps/web` includes shadcn-based normal Web login and separate management-console login/registration flows; external Web/native clients receive normal access/refresh tokens, while management-console users receive management-scoped tokens
  4. `tether gateway login` prompts for account credentials in the CLI, binds the local Gateway to the account/default workspace through Server, and receives or refreshes a Gateway token before publishing sessions through Relay
  5. HTTP write endpoints and WS ticket issuance reject missing, invalid, revoked, cross-account, or under-authorized tokens
  6. Browser WS uses a short-lived, single-use ticket scoped to account/workspace/Gateway/session/mode
  7. Relay authenticates both Gateway and client sockets and routes frames only inside authorized account/workspace/Gateway/session boundaries
  8. Normal users can access/control only their own sessions; multi-user session sharing, observer/controller roles, and control arbitration are deferred
  9. A logged-in user can open multiple Web/native clients, and Server pushes lightweight metadata/invalidation events to those devices so session lists, Gateway online state, logout, token/device revoke, and auth state changes sync without page refresh
  10. Identity-bearing audit events record account/workspace/user/device/Gateway/session or management admin identity without storing raw tokens
  11. Any UI shipped in this phase uses shadcn components and is limited to registration, login, authenticated session access, and Gateway binding; workspace/member/device/Gateway administration is Phase 6
**Plans**:
  - **Wave 1**:
    - `05-01-PLAN.md` — Server Scaffold, SQL Bootstrap, and Shared Auth Contract
    - `05-02-PLAN.md` — Web shadcn Foundation and Auth Shell
  - **Wave 2** *(blocked on Wave 1 completion)*:
    - `05-03-PLAN.md` — Server Auth, Gateway Binding, Notification, and Audit Runtime *(depends on Plans 01, 02)*
    - `05-04-PLAN.md` — Gateway Login, Direct Endpoint Authorization, and Scoped WS Tickets *(depends on Plans 01, 03)*
  - **Wave 3** *(blocked on Wave 1 and Wave 2 completion)*:
    - `05-05-PLAN.md` — Relay Token Authorization and Boundary Enforcement *(depends on Plans 01, 03, 04)*
    - `05-06-PLAN.md` — Web Registration, Login, Admin Auth Pages, and Authenticated Session Access *(depends on Plans 02, 03, 04)*
  - **Wave 4** *(blocked on Wave 2 and Wave 3 completion)*:
    - `05-07-PLAN.md` — Cross-Package Verification, E2E Auth Checks, and Phase Fact Sync *(depends on Plans 03, 04, 05, 06)*

### Phase 6: Account Management Console
**Goal**: Provide the first shadcn-based account management Web UI for operating the Phase 5 auth model without hand-editing data or relying on CLI-only administration
**Depends on**: Phase 5
**Requirements**: WEBUI-01, MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06
**Success Criteria** (what must be TRUE):
  1. The management console is built inside `apps/admin-web` using shadcn components and consistent layout primitives
  2. The management console has its own login and registration flow; the first registered management user is `super_admin`, and later management users are `admin` unless promoted by `super_admin`
  3. A logged-in management user can view the current account/workspace context and see their management permissions
  4. `super_admin` can manage management users and system/security settings; `admin` can manage normal users, normal user devices, Gateway unlinking, and audit viewing but cannot manage management users or system/security settings
  5. Users can view their devices; authorized management users can see each user's devices, device type, online/offline state, notification WebSocket state, and last seen time, then revoke devices and see revoke status reflected in token/session behavior
  6. Authorized management users can view registered Gateways, see last-seen/auth state, and unlink a Gateway so it can no longer publish sessions through Relay
  7. Authorized management users can inspect identity-bearing audit events filtered by account/workspace/user/device/Gateway/session/action without exposing raw tokens or secrets
  8. Authorized management users can see per-user login analytics: successful login count, failed login count, last login time, active/revoked devices, and recent auth/security events
**Plans**: 5 plans
Plans:
  - **Wave 1** (parallel):
    - [ ] `06-01-PLAN.md` — apps/admin-web 包脚手架、auth context、AdminLayout、admin-api.ts
    - [ ] `06-02-PLAN.md` — apps/server admin-auth 中间件、用户/管理用户 API、dashboard 统计
  - **Wave 2** *(blocked on Plan 02)*:
    - [ ] `06-03-PLAN.md` — apps/server 设备/Gateway/审计管理 API *(depends on Plan 02)*
  - **Wave 3** *(blocked on Plans 01 + 02/03)*:
    - [ ] `06-04-PLAN.md` — Dashboard 页和 Users 页 *(depends on Plans 01, 02)*
    - [ ] `06-05-PLAN.md` — Devices、Gateways、Audit 页 *(depends on Plans 01, 03)*

### Phase 7: Retention
**Goal**: The `session_events` table is bounded; the SQLite WAL file cannot grow unbounded during long Gateway uptimes
**Depends on**: Phase 6
**Requirements**: RETAIN-01
**Success Criteria** (what must be TRUE):
  1. Events older than 7 days are deleted automatically; after the retention job runs, no `session_events` row has a `ts` value older than 7 days
  2. When a single session's `session_events` rows exceed 100 MB (measured by `SUM(length(payload_json))`), the oldest rows for that session are deleted until the session is under limit
  3. The retention job runs every 15 minutes inside the Gateway process without blocking WS output to connected clients; `PRAGMA wal_checkpoint(RESTART)` runs on a separate 5-minute cadence
  4. The Gateway process exits cleanly (no dangling interval) when `close()` is called
**Plans**: TBD

### Phase 8: Security, Isolation Tests & Final Cleanup
**Goal**: The v0.3 milestone exit criteria are satisfied — integration tests verify account isolation, relay safety, auth properties, and the structured event schema is closed
**Depends on**: Phase 7 and completed Supervisor foundation
**Requirements**: TEST-01, CLEAN-03
**Success Criteria** (what must be TRUE):
  1. Integration tests assert that Relay rejects unauthenticated Gateway/client connections and never accepts arbitrary provider command/args/env frames
  2. Integration tests assert that Gateway startup without a valid Gateway token cannot publish sessions
  3. Integration tests assert that account A cannot list, subscribe to, or control account B sessions
  4. Integration tests assert that management-scoped tokens cannot control sessions, users cannot control sessions they do not own, and revoked tokens cannot obtain WS tickets or write
  5. Integration tests assert that `POST /api/sessions` with a non-whitelisted provider name is rejected
  6. Integration tests assert that API keys matching known patterns are redacted in `terminal.output` and `user.input` events stored in the DB
  7. Integration tests assert that the legacy snapshot (`GET /api/sessions/:id/snapshot`) and send (`POST /api/sessions/:id/send`) endpoints still respond correctly through the event store
  8. Integration tests assert that the retention job deletes the correct rows under both the 7-day time trigger and the 100 MB per-session size trigger
  9. `approval.requested`, `diff.detected`, and `agent.handoff` event types have an exhaustive-switch parser test that fails compilation when a new event type is added without a handler; roadmap and phase docs note that future review UI owns the full diff/approval surface
**Plans**: TBD

### Phase 9: Flutter Client App
**Goal**: Build a phone-first Flutter client surface that can remotely view and take over existing Gateway-owned agent sessions through Relay, with HarmonyOS compatibility documented. The app consumes Gateway/Relay protocol and generated Dart types from `packages/protocol`; it does not own sessions, start providers, duplicate auth decisions, or route Relay frames itself.
**Depends on**: Phase 8
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. Flutter app skeleton exists under `native/flutter/` with documented local dev/build/test commands and without breaking existing pnpm workspace validation
  2. The app supports Relay-first remote connection to list, view, observe/control, input, resize, detach from, and replay existing sessions
  3. The app embeds a real terminal-style interactive surface suitable for Codex/Claude-style TUIs, with any degraded fallback explicitly documented
  5. Dart protocol types or SDK are generated from `packages/protocol`, or the phase leaves a verified generation bridge with no separate hand-maintained Dart contract
  6. HarmonyOS compatibility risks for Flutter plugins, terminal rendering, secure storage, WebSocket behavior, and packaging are researched and documented before implementation choices are locked
  7. The app never sends arbitrary command/provider args/env/process creation requests and never duplicates Gateway session ownership, auth decisions, or Relay routing logic
  **Plans**: 6 plans
  Plans:
  - **Wave 1** (no deps):
    - [x] `09-01-PLAN.md` — Flutter 项目骨架、pubspec.yaml 依赖、Dart 协议类型（14变体）、ARB i18n 文件、ThemeData 常量
  - **Wave 2** *(depends on Plan 01)*:
    - [x] `09-02-PLAN.md` — AuthService（flutter_secure_storage token + QueuedInterceptor 刷新）+ RelayClient（Relay WS 状态机）
    - [x] `09-03-PLAN.md` — ConversationService（chat-first Relay 事件聚合层）
  - **Wave 3** *(depends on Plans 02, 03)*:
    - [x] `09-04-PLAN.md` — LoginScreen + RegisterScreen + SessionListScreen + SettingsScreen + widgets
    - [x] `09-05-PLAN.md` — Chat-first SessionScreen + TerminalScreen + ReplayScreen
  - **Wave 4** *(depends on all prior plans)*:
    - [ ] `09-06-PLAN.md` — OHOS 兼容性验证 + 全量测试 + OHOS_SETUP.md + OHOS_NOTES.md + human verify checkpoint

### Phase 10: Multi-workspace Expansion
**Goal**: Expand the v0.3 default-workspace model into full product support for multiple workspaces per account.
**Depends on**: Phase 6
**Requirements**: WORKSPACE-01
**Success Criteria** (what must be TRUE):
  1. Users can create and switch workspaces from `apps/web`
  2. Gateways can be bound or moved to a specific workspace
  3. Members and roles can be managed per workspace without leaking access across workspaces
  4. Session list, session access, audit filters, and management pages are scoped by active workspace
  5. Existing default-workspace accounts migrate without losing Gateway/session ownership
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Personal Relay MVP | 4/4 | Complete | 2026-05-01 |
| 2. Experience Hardening | 0/TBD | Not started | - |
| 3. Cleanup | 4/4 | Complete    | 2026-05-02 |
| 4. Account & Auth Contract | 1/1 | Complete    | 2026-05-02 |
| 5. Web-first Account Setup & Server Auth Runtime | 7/7 | Complete | 2026-05-04 |
| 6. Account Management Console | 6/6 | Complete | 2026-05-04 |
| 7. Retention | 0/TBD | Not started | - |
| 8. Security, Isolation Tests & Final Cleanup | 0/TBD | Not started | - |
| 9. Flutter Client App | 5/6 | In progress | - |
| 10. Multi-workspace Expansion | 0/TBD | Not started | - |
| 11. Agent 实时对话视图 | 4/4 | Complete | 2026-05-08 |
| 12. Server DB Runtime Sync | 0/7 | Not started | - |
| 13. Mobile Web Chat | 0/6 | Not started | - |

### Phase 11: Agent 实时对话视图

**Goal:** JSONL-based structured conversation view alongside PTY stream: JournalWatcher reads Claude/Codex JSONL files, writes assistant turns to conversation_turns DB, pushes agent.turn events; mobile gets dual-bubble chat UI with history, option chips, and fallback hint.
**Requirements**: AGENT-01
**Depends on:** Phase 10
**Plans:** 4/4 plans complete

Plans:
  - **Wave 1** (parallel):
    - [ ] `11-01-PLAN.md` — Protocol client.chat types + conversation_turns DB table + Store methods + unit tests
  - **Wave 2** *(depends on Plan 01)*:
    - [ ] `11-02-PLAN.md` — Relay forwarding + chat-handler.ts + relay-client.ts + daemon.ts chat case + GET /api/sessions/:id/conversation
  - **Wave 3** *(depends on Plan 02)*:
    - [ ] `11-03-PLAN.md` — JournalWatcher class + SessionRunner lifecycle wiring
  - **Wave 4** *(depends on Plan 03)*:
    - [ ] `11-04-PLAN.md` — agent.select detection + i18n keys + /chat route + ChatSessionSurface rewrite + human verify

### Phase 12: Server DB Runtime Sync

**Goal:** Web/App 从 Server DB 直接读取 session 列表、聊天历史和受限 Terminal 历史，不再依赖 Gateway 反向 RPC。Relay 收到 Gateway 上报的 `gateway.sessions` / `gateway.conversation` / `gateway.event` frame 后，通过内部 HTTP sync API 实时持久化到 Server DB，实现 Gateway 离线时历史仍可读、多端数据一致。
**Requirements**: SYNC-01
**Depends on:** Phase 11
**Plans:** 8 plans

**Cross-cutting constraints:**
- 所有 sync 写入前必须通过 `TETHER_RUNTIME_SYNC_SECRET` header 校验（D-06），nginx 额外限 127.0.0.1（D-06）
- 写 gateway_chat_messages / gateway_runtime_events 前先查 gateway_sessions 验证 account/workspace/gateway 归属（D-03 防串）
- Relay syncToServer 调用必须为 `void`（不 await），sync 失败只 console.warn 不阻塞转发（D-04, D-05）

Plans:
  - **Wave 0** (no deps — test scaffold):
    - [x] `12-00-PLAN.md` — 测试文件脚手架（runtime-sync.test.ts + session-read.test.ts + relay.test.ts 追加）
  - **Wave 1** *(no deps — can run parallel with Wave 0)*:
    - [x] `12-01-PLAN.md` — SQL migration (002_gateway_runtime_sync.sql) + db.ts ensureSchema 动态加载
  - **Wave 2** *(blocked on Wave 0 + Wave 1 completion)*:
    - [x] `12-02-PLAN.md` — Server runtime-sync 写接口（controller + service + middleware + router）
    - [x] `12-03-PLAN.md` — Relay syncToServer 调用（handleGatewayFrame 三个 case 追加 void 调用）
  - **Wave 3** *(blocked on Wave 2 completion)*:
    - [x] `12-04-PLAN.md` — Server session 读接口（GET /api/sessions + /conversation + /events）+ nginx 路由配置
    - [x] `12-05-PLAN.md` — Egg schedule 定时清理任务（app/schedule/ 首建）
  - **Wave 4** *(blocked on Wave 3 completion)*:
    - [x] `12-06-PLAN.md` — Gateway conversation_turns 废弃（store.ts DDL 删除 + journal-watcher.ts 清理）
    - [x] `12-07-PLAN.md` — Flutter ConversationService 切换（移除 Relay WS fallback）

**Success Criteria** (what must be TRUE):
  1. 生产环境 `GET /api/sessions/:id/conversation` 不再 404，直接从 `gateway_chat_messages` 读取
  2. `GET /api/sessions` 从 `gateway_sessions` 读取，Gateway 在线时 Web/App 看到同一份 session 列表
  3. Web 发送消息后，App 刷新能看到相同 conversation（多端同源）
  4. Gateway 临时离线后，历史 conversation 和受限 terminal 历史仍能打开
  5. `POST /api/sessions/:id/input` 和 `POST /api/sessions/:id/stop` 仍走 Relay → Gateway 反向 RPC
  6. 重复收到同一个 `gateway.conversation` 不产生重复 chat message（幂等 upsert）
  7. `terminal.output` 只进入 `gateway_runtime_events`，有掩码、限量和保留策略
  8. 不同 account/workspace 之间不能串 session、chat message 或 runtime event

### Phase 13: Mobile Web Chat

**Goal:** 在现有 `apps/web` 中新增 `/chats` 路由，实现类微信三栏布局的 AI 聊天界面。用户可从手机/浏览器创建 AI 会话（选择 Claude/Codex/Copilot 及具体模型），发送消息后通过 Relay WS → Gateway stream-json 链路执行，实时渲染流式 delta（打字机效果 + Markdown），收到 agent.result 后追加花费卡片。会话历史通过 HTTP 从 Server DB 加载，支持断线续传（Gateway 内存缓存 + catchup 帧）。

**Depends on:** Phase 12

**Requirements:** TBD

**Success Criteria** (what must be TRUE):
  1. 登录后 `/chats` 路由可访问，显示三栏布局（56px 导航 + 280px 会话列表 + 聊天区）；手机 <768px 时折叠为单列+汉堡菜单
  2. 新建会话时可选 provider（claude/codex/copilot）、model、cwd；第一条消息发出时 Gateway 隐式创建 session，回 `gateway.session-created { sessionId }`
  3. agent.delta 实时渲染到 AI 气泡（打字机），agent.result 到达后追加花费卡片；用户消息纯文本，AI 回复完整 Markdown（代码高亮+复制、表格、GFM）
  4. 会话列表通过 HTTP `GET /api/server/chat-sessions` 加载；历史消息通过 HTTP `GET /api/server/chat-sessions/:id/messages` 加载，直接渲染，不经过 WS
  5. 用户中途退出后重新进入，若 Gateway subprocess 仍在运行则收到 `gateway.chat-catchup` 帧恢复断点；若 subprocess 已崩溃显示"回复丢失，请重试"
  6. Gateway 新增 `session_chats_events` 表（独立于 PTY 的 `session_events`）；Server DB 新增 `gateway_chat_messages` 表（迁移文件 004）
  7. 中途换模型触发摘要流程，前端气泡不清空并插入系统消息
  8. 设置/账号 tab 展示 Claude CLI 订阅信息（若 CLI 支持）

**Plans**: 6 plans

Plans:
  - **Wave 1** (no deps):
    - [ ] `13-01-PLAN.md` — Protocol 帧类型扩展（9 个新帧变体）+ Gateway session_chats_events 表 + Server migration 004
  - **Wave 2** *(depends on Plan 01, parallel)*:
    - [ ] `13-02-PLAN.md` — Gateway ChatSessionRunner（piped subprocess）+ relay-client 新帧处理
    - [ ] `13-03-PLAN.md` — Relay 白名单扩展 + client.chat 直通 + Server chat-sessions HTTP API
  - **Wave 3** *(depends on Plans 01 + 03, parallel)*:
    - [ ] `13-04-PLAN.md` — Web 路由 + i18n keys + 三栏布局 + 会话列表（routes、messages、layout、session-list）
    - [ ] `13-05-PLAN.md` — Chat UI 原子组件（气泡、工具卡、花费卡、流式光标、thinking dots）
  - **Wave 4** *(depends on all prior plans)*:
    - [ ] `13-06-PLAN.md` — 端对端集成（ChatPanel + chats-layout 更新）+ human verify checkpoint

### Phase 14: Multi-device Gateway Routing

**Goal:** 允许同一账号在多台设备上各自绑定稳定 Gateway 记录，Web 显示选择器，Relay 按 gatewayId 严格路由，禁止任何 fallback。
**Requirements**: GATEWAY-MULTI-01, GATEWAY-MULTI-02, GATEWAY-MULTI-03, GATEWAY-MULTI-04, GATEWAY-MULTI-05, GATEWAY-MULTI-06
**Depends on:** Phase 13
**Plans:** 4/6 plans executed

Plans:
  - **Wave 1** (no deps):
    - [ ] `14-01-PLAN.md` — gateways 表 migration 008（添加 device_key/hostname/local_port，更换 unique key）
  - **Wave 2** *(depends on Plan 01)*:
    - [ ] `14-02-PLAN.md` — 服务端 upsert-by-device-key + GET /api/server/gateways
    - [ ] `14-03-PLAN.md` — CLI device.json + auth.json 简化 + decodeGatewayToken + 4 callsite 修复（原子）
  - **Wave 3** *(depends on Plan 02)*:
    - [ ] `14-04-PLAN.md` — Protocol gatewayId 类型更新 + Web sendFrame 注入 + gateway_required 处理
  - **Wave 4** *(depends on Plan 04)*:
    - [ ] `14-05-PLAN.md` — Relay 移除 fallback + gateway_required/gateway_unauthorized + 隔离测试
  - **Wave 5** *(depends on Plans 04 + 05)*:
    - [ ] `14-06-PLAN.md` — GatewaySelector 组件 + 离线禁用 + human verify

### Phase 15: Chat Remote Session Metadata

**Goal:** Chat 链路不再依赖 Gateway 本地 SQLite。Relay 收到已有 session 的 `client.chat` 后，从 Server DB 补齐可信 metadata（provider / projectPath / agentSessionId / gatewayId），通过 `RelayToGatewayChatFrame.session` 转发给 Gateway；Gateway 续聊直接用 `frame.session` 执行 provider resume，不查本地 `store.getSession()`。新建 chat 时 Gateway 显式上报完整 metadata，不依赖 `sendSessions()` 间接同步。

**Depends on:** Phase 14
**Canonical Refs:**
  - `docs/working/2026-05-11-chat-remote-session-metadata.md` — 完整设计文档（目标协议、TODO、风险、验收）

**Success Criteria** (what must be TRUE):
  1. 已有 chat 续聊时，Gateway 不调用 `store.getSession(sessionId)`，直接用 `frame.session` 中的可信 metadata 执行 provider resume（即使本地 SQLite 没有该 session 行）
  2. 新建 chat 时，Gateway 不调用 `store.insertSession()`；session metadata 通过显式 `gateway.chat-session-created` 帧上报到 Relay/Server
  3. Chat 链路不调用 `store.touchSession()` 或 `store.updateAgentSessionId()`；`last_active_at` 和 `agent_session_id` 只通过 Server DB 更新
  4. Relay 收到 `client.chat`（已有 session）后，从 Server 内部接口（`GET /api/relay/gateway-sessions/:sessionId/metadata`）获取可信 metadata，并在转发给 Gateway 前完成权限和 transport 校验
  5. `agent_session_id` PATCH 带 accountId/gatewayId/userId scope；Server WHERE 限定 session 归属，不允许跨账号更新
  6. PTY session 误发 `client.chat` 时，Relay/Gateway 返回明确错误，不走 chat runner
  7. `rg appendChatEvent\|listChatEvents\|insertSession\|touchSession\|updateAgentSessionId` 在 chat 链路代码中输出为空

**Plans**: 6 plans across 5 waves

Plans:
  - **Wave 0** (no deps — test scaffold):
    - [x] `15-P00-test-scaffold.md` — 四个测试文件追加 Phase 15 RED 测试桩（T1/T2/T4/T5/T7/A7/A8）
  - **Wave 1** (no deps — can run parallel with Wave 0):
    - [x] `15-P01-protocol-types.md` — Protocol 帧类型扩展（TrustedChatSessionMetadata + gateway.chat-session-created + RelayServerToGatewayFrame session 字段）
  - **Wave 2** *(depends on Wave 1, parallel streams)*:
    - [x] `15-P02-server-metadata-api.md` — Server metadata 只读接口 + updateAgentSessionId scope 修复
    - [x] `15-P03-relay-metadata-intercept.md` — Relay client.chat 拦截 + metadata 查询 + gateway.chat-session-created 处理
  - **Wave 3** *(depends on Waves 1 + 2)*:
    - [x] `15-P04-gateway-runner-rewrite.md` — Gateway ChatSessionRunner 去本地 DB + relay-client 更新
  - **Wave 4** *(depends on Wave 3)*:
    - [x] `15-P05-last-active-migration-typecheck.md` — last_active_at 更新 + PATCH scope + 全量 typecheck + UAT checkpoint

---
*Roadmap created: 2026-05-01*
*Milestone reordered: 2026-05-01 — personal Relay MVP moved to Phase 1*
*Execution order update: 2026-05-01 — Phase 6 pulled forward after Phase 1 for solo-use Gateway persistence*
*Scope update: 2026-05-02 — multi-account auth promoted into v0.3; shared-secret Relay remains bootstrap only*
*Scope update: 2026-05-02 — Account Management Console split out as Phase 6; Retention moved to Phase 7; pulled-forward Supervisor recorded as completed foundation*
*Scope update: 2026-05-02 — Phase 5 changed to Web-first setup/login plus dedicated apps/server; Relay remains routing-only and management UI remains Phase 6*
*Scope update: 2026-05-02 — WORKSPACE-01 promoted to Phase 10 for future discuss/plan flow*
*Scope update: 2026-05-05 — Phase 11 Agent 实时对话视图 planned: 4 plans across 4 waves*
*Scope update: 2026-05-09 — Phase 12 Server DB Runtime Sync added: Web/App 读取改为 Server DB，Relay 同步 Gateway frame 到 Server*
*Scope update: 2026-05-10 — Phase 13 Mobile Web Chat planned: 6 plans across 4 waves*
*Scope update: 2026-05-11 — Phase 14 Multi-device Gateway Routing planned: 6 plans across 5 waves*
*Scope update: 2026-05-11 — Phase 15 Chat Remote Session Metadata added: chat 链路去本地 SQLite，Relay 补可信 metadata*
*Coverage: 40/40 v1 requirements mapped*
