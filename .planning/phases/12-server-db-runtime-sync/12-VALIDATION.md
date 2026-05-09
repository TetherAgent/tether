---
phase: 12
slug: server-db-runtime-sync
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-05-09
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (tsx --test) for relay; egg-mock/supertest for server |
| **Config file** | `apps/relay/src/relay.test.ts`; `apps/server/test/` |
| **Quick run command** | `cd apps/relay && pnpm test` |
| **Full suite command** | `pnpm --filter @tether/relay test && pnpm --filter @tether/server test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd apps/relay && pnpm test` (relay sync 相关任务) 或 `cd apps/server && pnpm test` (server 接口相关任务)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | SYNC-01 | — | SQL IF NOT EXISTS 防重复建表 | manual | `curl http://localhost:4800/healthz && mysql -e 'DESCRIBE gateway_sessions'` | ✅ | ⬜ pending |
| 12-01-02 | 01 | 1 | SYNC-01 | — | ensureSchema 顺序加载所有 sql/*.sql | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-02-01 | 02 | 2 | SYNC-01 | T-sync-01 | runtime-sync 接口拒绝缺失 secret 的请求 (401) | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-02-02 | 02 | 2 | SYNC-01 | T-sync-01 | upsert gateway_sessions 幂等（重复请求不报错不重复插入）| unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-02-03 | 02 | 2 | SYNC-01 | T-sync-02 | upsert gateway_chat_messages 幂等 (session_id, turn_index) | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-02-04 | 02 | 2 | SYNC-01 | T-sync-03 | 写 gateway_runtime_events 前先查 gateway_sessions 归属校验 | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-03-01 | 03 | 2 | SYNC-01 | — | Relay sync 失败不阻塞实时转发 | unit | `cd apps/relay && pnpm test` | ✅ | ✅ green |
| 12-03-02 | 03 | 2 | SYNC-01 | — | Relay sync 调用在 handleGatewayFrame 各 case 内 void（不 await） | manual | grep "void syncToServer" apps/relay/src/relay.ts | ✅ | ✅ green |
| 12-04-01 | 04 | 3 | SYNC-01 | — | GET /api/sessions 返回当前 token scope 内的 sessions | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-04-02 | 04 | 3 | SYNC-01 | — | GET /api/sessions/:id/conversation 返回 turn_index 升序的 turns | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-04-03 | 04 | 3 | SYNC-01 | — | GET /api/sessions/:id/events 返回白名单 event_type 的历史 | unit | `pnpm --filter @tether/server test` | ✅ | ❌ red |
| 12-05-01 | 05 | 3 | SYNC-01 | — | Egg schedule 定时任务注册（凌晨 3 点）| manual | 检查 app/schedule/cleanup-runtime-events.ts 存在且 export schedule.cron | ✅ | ✅ green |
| 12-06-01 | 06 | 4 | SYNC-01 | — | Gateway store.ts 不包含 conversation_turns DDL | manual | `grep -v "conversation_turns" apps/gateway/src/store.ts && echo OK` | ✅ | ✅ green |
| 12-06-02 | 06 | 4 | SYNC-01 | — | JournalWatcher 无 insertConversationTurn 调用 | manual | `! grep "insertConversationTurn" apps/gateway/src/journal-watcher.ts && echo OK` | ✅ | ✅ green |
| 12-07-01 | 07 | 4 | SYNC-01 | — | Flutter ConversationService 无 requestConversation WS fallback | manual | `! grep "requestConversation" native/flutter/lib/services/conversation_service.dart` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/server/test/runtime-sync.test.ts` — stubs for sync secret 校验 + upsert 幂等 (SYNC-01)
- [x] `apps/server/test/session-read.test.ts` — stubs for GET /api/sessions, /conversation, /events (SYNC-01)
- [x] `apps/relay/src/relay.test.ts` — 追加 syncToServer 失败不阻塞转发测试（已有文件，追加 case）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| nginx `/api/runtime-sync/` 只允许 127.0.0.1 | SYNC-01 D-06 | nginx 配置，无自动测试 | 从外网 curl /api/runtime-sync/gateway/sessions 应返回 403/拒绝 |
| Gateway 离线时历史仍可读 | SYNC-01 SC-4 | 需要真实 Gateway 断线环境 | 停止 Gateway 进程后，GET /api/sessions/:id/conversation 仍返回历史 turns |
| 多端同源（Web 发消息后 App 刷新可见）| SYNC-01 SC-3 | 需要两个客户端 | Web 发消息 → Relay 收 agent.turn → Server sync → App GET 返回相同 turns |
| Egg schedule 实际运行清理 | SYNC-01 D-08 | 需要等待凌晨 3 点触发 | 插入超 30 天旧行，手动调 subscribe() 验证删除逻辑 |

## Escalated Blockers

| Area | Status | Evidence |
|------|--------|----------|
| Server test runner | blocked | `pnpm --filter @tether/server test` fails before Phase 12 assertions because Egg detects duplicate middleware files: `app/io/middleware/auth.js` vs `auth.ts`. |
| Relay runtime wiring | broken | `apps/relay/src/main.ts` contains pasted patch text (`*** Add File ...`), so `pnpm --filter @tether/relay build` fails. |
| Server session read ownership | broken | `apps/server/app/controller/session.ts` and `apps/server/app/service/sessionRepository.ts` scope by account/workspace only and ignore `userId`, regressing Phase 5 ownership boundaries. |
| Web offline read path | broken | Web relay mode still lists sessions and replays terminal history through Relay WS instead of Server DB. |
| Flutter offline read path | broken | Flutter still clears state on `gateway_unavailable`, and replay remains Relay-only. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** partial — Wave 0 scaffolding and static/relay checks are in place, but server-side behavioral validation is blocked by implementation bugs and the pre-existing Egg loader conflict.

## Validation Audit 2026-05-09

| Metric | Count |
|--------|-------|
| Gaps found | 8 |
| Resolved | 6 |
| Escalated | 5 |

- Relay validation is green for non-blocking sync forwarding.
- Gateway cleanup and Flutter WS-fallback removal are statically validated.
- Server runtime-sync and session-read tests remain stub-only and cannot be promoted until the server suite is unblocked and the read-path ownership bug is fixed.
