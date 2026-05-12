---
quick_id: 260512-qte
slug: docs-working-2026-05-12-gateway-runtime-
status: complete
completed_at: "2026-05-12T11:23:17Z"
---

# Quick Task 260512-qte Summary

## Scope

执行 `docs/working/2026-05-12-gateway-runtime-split.md` 的 Wave 1：抽 `relay-sender`。

## Changes

- 新增 `apps/gateway/src/relay/relay-sender.ts`，集中封装 Gateway outgoing relay frame 发送。
- 更新 `apps/gateway/src/relay-client.ts`，将 `gateway.event`、`gateway.error`、`gateway.sessions`、`gateway.chat-catchup`、`gateway.replay`、`gateway.session-created`、`gateway.chat-session-created` 发送路径迁入 `RelaySender`。
- 回写 `docs/working/2026-05-12-gateway-runtime-split.md` Wave 1 TODO 和验收项。

## Verification

- `pnpm --filter @tether/gateway typecheck`
- `pnpm --filter @tether/gateway test -- relay-client.test.ts`

## Notes

- 本次只执行 Wave 1，没有继续拆 `pty-handler`、`chat-handler` 或 `session-catalog`。
- `relay-client.ts` 仍保留底层 WebSocket `send(frame)` 和 frame dispatch，后续 Wave 再继续切职责。
