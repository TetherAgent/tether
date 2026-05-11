---
phase: 15
slug: chat-remote-session-metadata
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (gateway)** | Node.js built-in test runner (`node:test`) |
| **Framework (relay)** | `tsx --test` |
| **Framework (server)** | `egg-mock` + mocha-style |
| **Config file** | 无独立配置，命令在各 package.json |
| **Quick run command** | `pnpm --filter @tether/gateway test && pnpm --filter @tether/relay test` |
| **Full suite command** | `pnpm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command for the affected package
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| A2 | protocol | 1 | D-01 | — | RelayToGatewayChatFrame 包含 session 字段 | grep | `grep -r "TrustedChatSessionMetadata" packages/protocol/src` | ❌ W0 | ⬜ pending |
| A3 | gateway | 3 | D-05 | T-15-01 | store.getSession 不在 chat 分支调用 | grep | `rg "store\.getSession" apps/gateway/src/chat-session-runner.ts` | ❌ W0 | ⬜ pending |
| A4 | gateway | 3 | D-06 | — | insertSession 不在 chat 链路调用 | grep | `rg "insertSession" apps/gateway/src/chat-session-runner.ts` | ❌ W0 | ⬜ pending |
| A5 | gateway | 3 | D-06 | — | touchSession/updateAgentSessionId 不在 chat 链路调用 | grep | `rg "touchSession\|updateAgentSessionId" apps/gateway/src/chat-session-runner.ts` | ❌ W0 | ⬜ pending |
| A6 | gateway | 3 | D-05 | — | PTY 链路不受影响 | unit | `pnpm --filter @tether/gateway test` | ✅ store.test.ts | ⬜ pending |
| A7 | relay | 2 | D-08 | T-15-02 | transport!='chat' 的 session 被 Relay 拒绝 | unit | `pnpm --filter @tether/relay test` | ❌ W0 | ⬜ pending |
| A8 | relay | 2 | D-09 | T-15-03 | Web 帧不能携带 provider/projectPath metadata | unit | `pnpm --filter @tether/relay test` | ❌ W0 | ⬜ pending |
| T1 | relay | 2 | D-03 | T-15-01 | Relay 从 Server DB 补齐 metadata 后转发给 Gateway | unit | `pnpm --filter @tether/relay test` | ❌ W0 | ⬜ pending |
| T2 | relay | 2 | D-13 | T-15-02 | A 用户不能访问 B 用户 chat session（跨账号隔离） | isolation unit | `pnpm --filter @tether/relay test` | ❌ W0 | ⬜ pending |
| T4 | gateway | 3 | D-05 | — | 本地没有 sessions 行也能 provider resume | unit | `pnpm --filter @tether/gateway test` | ❌ W0 | ⬜ pending |
| T5 | gateway | 3 | D-06 | — | 新建 chat session 本地 SQLite 没有新行 | unit | `pnpm --filter @tether/gateway test` | ❌ W0 | ⬜ pending |
| T7 | server | 2 | D-07 | T-15-03 | updateAgentSessionId PATCH 带 scope，WHERE 限定归属 | unit | `pnpm --filter @tether/server run test` | ❌ W0 | ⬜ pending |
| T10 | server | 4 | D-12 | — | 旧库/空库 upsertGatewaySession 不受 workspace_id 影响 | unit | `pnpm --filter @tether/server run test` | ✅ runtime-sync.test.ts | ⬜ pending |
| typecheck | all | 4 | — | — | 全量 TypeScript 类型检查 | type | `pnpm --filter @tether/gateway exec tsc -p tsconfig.json --noEmit && pnpm --filter @tether/relay exec tsc -p tsconfig.json --noEmit && pnpm --filter @tether/server run typecheck` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/relay/test/relay.test.ts` — 新增 T1/T2/A7 用例（metadata 补齐、跨账号隔离、transport 校验）
- [ ] `apps/gateway/test/chat-session-runner.test.ts` — 新增 T4/T5/A3/A4/A5 用例（无本地续聊、新建不写本地）
- [ ] `apps/gateway/test/relay-client.test.ts` — 新增 A8 用例（PTY session 发 client.chat 被拒、Web 帧约束）
- [ ] `apps/server/test/chat-repository.test.ts` — 新增 T7 用例（updateAgentSessionId scope 校验）

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Gateway 重启后续聊 | T8 | 需要本地 4 服务拓扑 | 停 Gateway，重启，发 chat 消息，确认 Relay 从 Server DB 补 metadata |
| Relay 断线/Server sync 失败 | T9 | 需要模拟网络中断 | 停 Server，发 chat 消息，确认明确错误而非静默丢消息 |
| 新建 chat 首条消息刷新竞争 | T14 | 需要快速刷新 | 新建 chat 后立即刷新，确认 session 和第一条消息可见 |
| 本地 SQLite 无 chat session 行 | UAT | 需要 sqlite3 工具 | `sqlite3 ~/.tether/tether.db "select id from sessions where transport='chat';"` 应返回空 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
