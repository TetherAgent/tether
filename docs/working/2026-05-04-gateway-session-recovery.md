# Gateway 重启后的 session 恢复缺口

本文记录 Gateway 重启后，历史 `running` session 状态和真实 PTY ownership 不一致的问题。
这是后端待设计/待实现事项，不是当前已完成能力。

## 问题背景

当前 Gateway 重启后，前端可以自动重连 Gateway，但后端还没有完整的 session 恢复语义。

关键风险是：SQLite store 里仍可能记录某个 session 为 `running`，但新的 Gateway 进程
内存里已经没有对应的 PTY manager / child process 句柄。此时 Web 如果继续把它当成可控
running session 展示，会误导用户。

## 后端需要补齐的能力

1. Gateway 启动时读取 store 里的 `running` sessions。
2. 对每条 `running` session 做健康检查：
   - 如果 PTY process 仍由当前 Gateway manager 持有，继续保持 `running`。
   - 如果当前 Gateway manager 不持有，但能确认 CLI attach / provider 进程仍活着，标记为
     `lost` 或后续新增的 `detached`，表示有历史记录但当前不可控。
   - 如果进程不存在，标记为 `stopped` 或 `lost`，不得继续暴露为 `running`。
3. `/api/sessions` 不应把不可控旧 session 继续返回为 `running`。Active 列表只能代表当前
   Gateway 能控制或能确认仍被托管的 session。
4. `/api/sessions/:id/stream` 对不可恢复 session 必须返回明确错误，而不是让 Web 一直卡在
   旧终端画面。建议错误码：
   - `session_lost`
   - `gateway_restarted`
   - `session_not_attached`
5. 如果要真正做到 Gateway 重启后恢复控制，session 不能只存在于旧 Gateway 进程内存里。
   需要一个可重附着的 PTY/session supervisor：由长期子进程、独立 supervisor 或其他可
   重新发现的 process ownership 模型托管 PTY，使新 Gateway 能重新接管。

## 短期产品口径

- Gateway 不可用或刚重启时，Web 应显示“正在重连 / Gateway 重启中”。
- Gateway 恢复但 session 不在新 Gateway 托管范围内时，Web 应显示“Gateway 已恢复，但
  这个 session 未被重新托管”。
- Sessions active 区不应展示不可控旧 session；这类记录只能进入历史或失联态。

## 当前结论

这不是前端状态问题，而是 Gateway runtime ownership 模型的后端缺口。前端只能做自动重连
和明确错误展示，不能凭旧 state 恢复控制权。
