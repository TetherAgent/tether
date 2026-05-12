---
quick_id: 260512-qte
slug: docs-working-2026-05-12-gateway-runtime-
status: complete
completed_at: "2026-05-12T12:08:45Z"
---

# Quick Task 260512-qte Summary

## Scope

执行 `docs/working/2026-05-12-gateway-runtime-split.md` 的 Gateway runtime split。

## Changes

- 新增 `apps/gateway/src/relay/frame-router.ts`、`relay-sender.ts`、`session-catalog.ts`、`subscription-manager.ts`、`pty-handler.ts`、`chat-handler.ts`。
- 新增 `apps/gateway/src/chat/chat-session-registry.ts`、`chat-runtime.ts`、`provider-registry.ts` 和 `chat/providers/*`。
- 将 `pty.ts`、`session-runner*.ts`、`agent-select-detect.ts`、`replay.ts` 移入 `apps/gateway/src/pty/` 目标目录。
- 将 Gateway 共享工具收敛到 `apps/gateway/src/utils/`。
- `RelayClientOptions.onNewPtySession` 不再暴露客户端传入的 `command` 字段。
- `client.permission_response` 增加订阅检查，未订阅 client 返回 `not_subscribed`。
- runner socket write/resize/stop 失败路径统一标记 lost 并广播 `session.error`。
- 回写 `docs/working/2026-05-12-gateway-runtime-split.md` Wave 1-8 TODO 和验收项。

## Verification

- `pnpm --filter @tether/gateway typecheck`
- `pnpm --filter @tether/gateway test -- relay-client.test.ts`
- `pnpm --filter @tether/gateway test`

## Notes

- 本次未改 Relay / Gateway / Client 协议字段。
- 本次未改 Server / MySQL schema，也未恢复本地 SQLite / Store。
- 本次未拆 `apps/gateway` 为多个 package 或多个常驻进程。
