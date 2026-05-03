---
status: partial
phase: 06-account-management-console
source: [06-VERIFICATION.md]
started: 2026-05-03T04:56:05Z
updated: 2026-05-03T04:56:05Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 设备页「最后在线时间」和「通知 WebSocket 状态」是否满足 SC-5

expected: SC-5 要求展示「通知 WebSocket 状态」和「最后在线时间」字段。当前实现：lastSeenAt 在代码中始终为 null（devices 表无 last_seen_at 列），DevicesPage 渲染了「最后在线时间」列（格式化后显示 —）；「通知 WS 状态」列不存在（CONTEXT.md D-17 决定不展示）。
result: [pending]

### 2. 设备吊销是否满足「revoke status reflected in token/session behavior」

expected: 已吊销设备的所有 token 均无效。当前实现只撤销 refresh_tokens（CR-02 指出 gateway_refresh_tokens 未被 revokeRefreshTokensByDeviceId 撤销），无法关闭已有 WS 连接。
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
