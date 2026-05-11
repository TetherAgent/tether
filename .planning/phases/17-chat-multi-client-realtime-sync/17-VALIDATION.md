---
phase: 17
slug: chat-multi-client-realtime-sync
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `apps/relay/vitest.config.ts` |
| **Quick run command** | `pnpm --filter relay test --run` |
| **Full suite command** | `pnpm --filter relay test --run` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter relay test --run`
- **After every plan wave:** Run `pnpm --filter relay test --run`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | D-01/D-02 | — | chatSessionSubscribers Set 操作不跨账号泄漏 | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-01-02 | 01 | 1 | D-03 | — | 广播时 clientCanAccessSession 账号过滤 | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-01-03 | 01 | 1 | D-04 | — | 第二个 subscriber 独立触发 catch-up | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-02-01 | 02 | 2 | D-05/D-06 | — | chatClientBindings 移除后路由不中断 | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-02-02 | 02 | 2 | D-08/D-09 | — | in-flight 锁拒绝并发请求返回 chat_in_progress | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-02-03 | 02 | 2 | D-10/D-11 | — | 锁在 result/error/crash 后正确释放 | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |
| 17-03-01 | 03 | 3 | D-01~D-11 | — | 多账号隔离：A 账号事件不泄漏到 B | unit | `pnpm --filter relay test --run` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.
- `apps/relay/test/relay.test.ts` 已有完整测试框架和多账号隔离模板（L1927-L2033）
- 无需新增 fixtures 或框架安装

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
