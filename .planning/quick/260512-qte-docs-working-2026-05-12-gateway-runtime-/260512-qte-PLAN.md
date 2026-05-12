---
quick_id: 260512-qte
slug: docs-working-2026-05-12-gateway-runtime-
status: complete
created_at: "2026-05-12T11:18:29.090Z"
---

# Quick Task 260512-qte: Gateway runtime split Wave 1

执行 `docs/working/2026-05-12-gateway-runtime-split.md` 中的 Wave 1：抽 `relay-sender`。

## Tasks

1. 抽 Relay sender
   - Files: `apps/gateway/src/relay/relay-sender.ts`, `apps/gateway/src/relay-client.ts`
   - Action: 新增 sender 封装 `gateway.event`、`gateway.error`、`gateway.sessions`、`gateway.chat-catchup`、`gateway.replay`、`gateway.session-created` 等 Gateway outgoing frame。
   - Verify: `pnpm --filter @tether/gateway typecheck`；`pnpm --filter @tether/gateway test -- relay-client.test.ts`
   - Done: true

2. Quick task 状态回写
   - Files: `.planning/quick/260512-qte-docs-working-2026-05-12-gateway-runtime-/260512-qte-SUMMARY.md`, `.planning/STATE.md`
   - Action: 记录执行结果和验证命令。
   - Verify: SUMMARY frontmatter `status: complete`。
   - Done: true
