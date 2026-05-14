# Claude HUD 指标接入草稿

状态：Working

目标：把 Claude Code 的上下文用量、5 小时用量和 7 天用量接入 Tether Chat UI，让 Web 可以在会话状态区展示类似 HUD 的指标。

示例展示：

```text
Context 79% | Usage 5% resets 4h 17m | Weekly 1% resets 6d 21h
```

## 背景

Claude Code hook 的 stdin JSON 里可以拿到比 `stream-json` result 更接近 Claude HUD 的指标：

- `context_window.used_percentage`：Claude Code 已计算好的上下文窗口使用率。
- `rate_limits.five_hour.used_percentage`：5 小时窗口使用率。
- `rate_limits.five_hour.resets_at`：5 小时窗口重置时间，Unix 秒级时间戳。
- `rate_limits.seven_day.used_percentage`：7 天窗口使用率。
- `rate_limits.seven_day.resets_at`：7 天窗口重置时间，Unix 秒级时间戳。

Context 的计算语义是输入侧 token 占上下文窗口的百分比：

```text
used% = round((input_tokens + cache_creation_input_tokens + cache_read_input_tokens) / contextWindowSize * 100)
```

`output_tokens` 不计入 Context 使用率。

## 当前 Tether 现状

当前 Chat 链路已经有部分指标能力：

- `apps/gateway/src/chat/chat-session-runner.ts` 的 `RateLimitInfo` 已支持：
  - Claude-style：`resetsAt / rateLimitType / status`
  - Codex-style：`primary / secondary / planType`
- Claude provider 使用 `claude -p --output-format stream-json --verbose --include-partial-messages`。
- Claude result 里已抽取：
  - `modelUsage.*.contextWindow`
  - 最后一次 `usage.iterations[*]` 的输入侧 token，作为 `contextInputTokens`
- Web 的 `ProviderUsageRows` 已支持展示：
  - `contextPct`
  - `primary.usedPercent / primary.resetsAt`
  - `secondary.usedPercent / secondary.resetsAt`
- 已知 Bug：`apps/web/src/components/chats/chat-panel.tsx` 只有 `frame.contextWindow` 存在时才更新 `usageStats`。这会导致只有 `rateLimitInfo` 或未来只有 `contextUsedPercentage` 的 `agent.result` 完全不更新 Usage / Weekly。
- 已知 Bug：`apps/web/src/components/chats/chat-utils.ts` 的 `usageStatsFromHistory()` 在历史消息没有 `contextWindow` 时直接返回 `undefined`。这会导致历史里即使有 `rateLimitInfo` 也无法恢复 Usage / Weekly。
- `apps/web/src/components/chats/chat-data.ts` 的 `ChatHistoryUsage` 还没有 `contextUsedPercentage` 字段。
- `packages/protocol/src/index.ts` 里的 `agent.result.rateLimitInfo` 类型仍只声明了 `resetsAt / rateLimitType / status`，落后于 Gateway/Web 实际使用。
- Protocol 的 `rateLimitInfo.resetsAt / rateLimitType / status` 目前还是 required 字段，但 Gateway 实际可能只发送 `primary / secondary / planType`，这些旧字段都可能不存在。修复时必须把旧字段改成 optional。

所以本方案不新增 `fiveHourUsedPercentage / sevenDayUsedPercentage` 这类 provider-specific 字段，而是复用现有 `primary / secondary` 结构。

## 指标模型

统一使用以下结构：

```ts
type RateLimitWindow = {
  usedPercent: number;
  windowMinutes?: number;
  resetsAt?: number;
};

type RateLimitInfo = {
  // 兼容旧 Claude stream-json rate_limit_event
  resetsAt?: number;
  rateLimitType?: string;
  status?: string;

  // 通用窗口指标
  primary?: RateLimitWindow;   // 5 小时窗口，windowMinutes = 300
  secondary?: RateLimitWindow; // 7 天窗口，windowMinutes = 10080
  planType?: string;
};
```

Claude hook 映射规则：

```ts
rateLimitInfo.primary = {
  usedPercent: rate_limits.five_hour.used_percentage,
  windowMinutes: 300,
  resetsAt: rate_limits.five_hour.resets_at
};

rateLimitInfo.secondary = {
  usedPercent: rate_limits.seven_day.used_percentage,
  windowMinutes: 10080,
  resetsAt: rate_limits.seven_day.resets_at
};
```

Context 指标优先级：

1. hook `context_window.used_percentage` 存为 `contextUsedPercentage`，Web 直接使用。
2. 如果 hook 没有原生百分比，沿用当前 `contextWindow + contextInputTokens` 计算。
3. 如果两者都没有，不展示 Context 行。

## 接入链路

```text
Claude Code hook (Stop)
  -> POST http://127.0.0.1:<gateway-port>/api/hook/claude/context
  -> Gateway 读取 hook payload 中的 Tether session identity
  -> Gateway 关联到 Tether chat sessionId
  -> Gateway 按 sessionId 缓存白名单指标
  -> ClaudeAdapter finishResult 短等待同 sessionId 的 hook 指标
  -> 命中则合并，超时则走 fallback
  -> agent.result.rateLimitInfo / contextUsedPercentage
  -> Relay WS
  -> Server usage_json
  -> Web ProviderUsageRows
```

说明：

- `Stop` 事件频率和一次完整回复结束更接近，适合补充 `agent.result` 指标。
- 不使用 `PostToolUse` 作为默认来源，因为它每个工具调用都触发，频率过高。
- hook 指标必须和当前 Tether chat session 精确关联；不能使用“全局最近一次 hook 指标”。
- TTL 只能作为过期保护，不能作为关联机制。
- `agent.result` 不能无限等待 hook。Gateway 最多等待一个很短的 bounded wait（建议 300-800ms），超时后发出不含 hook 指标的 `agent.result`，继续保留现有 fallback。
- hook 指标缓存 TTL 建议 60 秒，足够覆盖 bounded wait 和极短的时序抖动，同时避免长期积累过期指标。

## 会话关联要求

这是实现前置条件，不满足时不得把 hook 指标注入 `agent.result`。

优先方案：Tether 安装自己的 Claude hook wrapper，并在启动 Claude 子进程时显式传入 Tether session identity。hook wrapper POST 时把这个 identity 一并带给 Gateway。

候选方式：

- Gateway 生成 `TETHER_SESSION_ID=<sessionId>`，并通过 Claude 子进程环境传给 hook wrapper。
- 如果 Claude hook 进程不会继承该环境变量，则由 Tether-managed hook wrapper 从 hook stdin 中读取 `session_id / transcript_path` 等字段匹配。
- 如果两种方式都不可行，本期只能采样，不做生产注入。

不再把 `cwd / pid / transcript_path` 作为默认关联方案。它们只能作为采样阶段的候选证据或 fallback 评估项，不能在未验证唯一性的情况下用于生产注入。

Gateway 启动 Claude 子进程时，应记录：

```text
Tether chat sessionId -> Claude identity
```

具体注入点在 `apps/gateway/src/chat/chat-session-runner.ts` 的 `CliChatRunner.run()`。当前代码在创建 session 后执行：

```ts
const env = providerEffectiveEnv(this.adapter.provider, cwd);
const launch = providerLaunchCommand(this.adapter.provider, this.adapter.command, args, env);
const child = spawn(launch.command, launch.args, {
  cwd,
  stdio: ['pipe', 'pipe', 'pipe'],
  env
});
```

这里应在 `spawn` 前给 Claude provider 的 env 注入 `TETHER_SESSION_ID=sessionId`。不要把 session identity 放进 `CliProviderAdapter.buildArgs()`，因为 adapter args 不负责环境变量。

hook 到达时，应执行：

```text
hook identity -> Tether chat sessionId -> session metrics cache
```

`finishResult` 合并指标时，只允许读取同一个 `sessionId` 下的缓存：

```text
active.sessionId -> metricsBySessionId.get(active.sessionId)
```

禁止行为：

- 禁止全局保存“最近一次 Claude hook 指标”并注入下一次 `agent.result`。
- 禁止只靠短 TTL 猜测 hook 属于当前会话。
- 禁止无法匹配 session 时退化为全局注入。

如果 hook payload 无法提供可关联字段，本期只能先实现采样/调试，不实现生产注入。

## 时序要求

`Stop` hook 可能晚于 Claude stdout 的 `result` 到达。为了仍然把 hook 指标放进同一条 `agent.result`，`finishResult` 必须支持短等待：

```text
Claude result 到达
  -> 等待 metricsBySessionId.get(sessionId)，最多 300-800ms
  -> 命中：合并 contextUsedPercentage / rateLimitInfo
  -> 超时：发出原有 result，使用 stream-json fallback
```

不得无限等待 hook，避免回复完成后 UI 卡住。

如果 hook 在 `agent.result` 已经发出后才到达，本期不补发新 frame；该 hook 指标只用于 debug 观测或直接丢弃。原因是本期目标是保持最小协议面，不新增 metrics update frame。

实现结构建议：

```text
metricsStore:
  metricsBySessionId: Map<sessionId, HookMetrics>
  waitersBySessionId: Map<sessionId, Deferred<HookMetrics | null>>

hook 先到：
  -> 校验并写入 metricsBySessionId
  -> resolve waitersBySessionId[sessionId]（如果存在）

result 先到：
  -> 创建/读取 waitersBySessionId[sessionId]
  -> Promise.race(waiter.promise, timeout(300-800ms))
  -> 命中则合并；超时则 fallback
```

不要把 waiter 只挂在 `ActiveSubprocess` 上，否则 hook 先于 `result` 到达的分支会不清晰，也不利于 hook endpoint 独立解析和测试。

## 安全边界

Gateway 端点可以不走用户登录鉴权，但必须满足这些限制：

- 只绑定 `127.0.0.1`，不接受非回环地址访问。
- endpoint 只用于本机 Claude hook，不经过 Relay 暴露。
- request body 设置大小上限。
- 不保存、不转发完整 hook stdin JSON。
- 只提取白名单字段：
  - `context_window.used_percentage`
  - `rate_limits.five_hour.used_percentage`
  - `rate_limits.five_hour.resets_at`
  - `rate_limits.seven_day.used_percentage`
  - `rate_limits.seven_day.resets_at`
- 所有数值要做范围校验：
  - `used_percentage` 只接受 `0..100`
  - `resets_at` 必须是合理 Unix 秒级时间戳
- 缓存必须按 `sessionId` 隔离，并设置 TTL，过期后不再注入 `agent.result`。
- 无法匹配到 Tether chat session 的 hook payload 必须丢弃或仅进入 debug 采样日志，不得外发到 Web。

当主 Gateway HTTP 绑定 `0.0.0.0` 或局域网 IP 时，不能仅靠主路由声明“只允许本机”。实现必须二选一：

1. 为 hook endpoint 启动独立的 `127.0.0.1` listener。
2. 或在现有 Hono 路由里严格校验请求来源确实是回环地址。

默认优先独立 `127.0.0.1` listener，边界更清晰。

## Hook 安装和端口

Tether 不要求用户手写 `~/.claude/settings.json`，也不新增 `tether hooks install claude` /
`tether hooks uninstall claude` 命令。实现时由 `tether start` 自动管理 Tether 自己的 Claude hook block，并保持幂等：

```text
tether start
  -> 启动 Gateway，拿到 host/port
  -> 检查 Claude Code 是否存在
  -> 检查 ~/.claude/settings.json
  -> 如果没有 Tether-managed Stop hook：
       备份 settings.json
       写入 Tether hook block
       打印“正在安装 Claude HUD hook...”
  -> 如果已有但端口变了：
       备份 settings.json
       更新 hook endpoint
       打印“正在更新 Claude HUD hook 端口...”
  -> 如果已正确：
       不重复追加
```

代码归属：

- `apps/cli/src/gateway/hooks.ts`：实现 Claude settings 读写、Tether-managed block 合并、备份、幂等更新。
- `apps/cli/src/gateway/claude-hud-hook-script.ts`：维护要安装到本机的 hook wrapper 脚本内容。
- `apps/cli/src/gateway/supervisor.ts`：`tether start` 成功确定 Gateway host/port 后，调用 hook 检测/安装逻辑。
- `apps/gateway/src/daemon.ts`：只提供 hook endpoint 和当前 host/port 事实，不直接改用户 Claude 配置。
- `apps/gateway/src/chat/chat-session-runner.ts`：启动 Claude 子进程时注入/记录 Tether session identity。

本机文件位置：

- Tether 安装的 hook wrapper 写到 `~/.tether/hooks/claude-hud-hook.js`。
- Claude settings 里的 Tether-managed Stop hook 只指向这个文件，例如：

```text
node ~/.tether/hooks/claude-hud-hook.js --endpoint http://127.0.0.1:<port>/api/hook/claude/context
```

原因：

- `~/.tether/hooks/` 是 Tether 自己的运行时目录，便于幂等更新和卸载。
- 不把文件写进 `~/.claude/hooks/`，避免和用户已有 Claude hooks、GSD hooks、第三方插件混在一起。
- repo 内只保留 hook script 模板/生成逻辑；真正被 Claude 执行的是安装到用户本机的 `~/.tether/hooks/claude-hud-hook.js`。

规则：

- hook endpoint 使用当前 Gateway 配置端口，不写死 `4789`。
- Tether 只维护自己标记的 hook block，不改写用户已有 hook。
- 写入前备份原 settings。
- 更新必须幂等，多次启动不重复追加。
- 不依赖 `claude install`；`claude install` 是 Claude Code 本体安装/更新命令，不用于管理 Tether hook。
- 提供 Tether config 禁用开关，例如 `claudeHook.autoInstall = false`；也可支持环境变量 `TETHER_CLAUDE_HOOK_AUTO_INSTALL=0` 作为临时覆盖。
- 如果 Gateway 不是 `127.0.0.1` 绑定，不自动安装本机 hook，除非用户显式确认。

远程/Relay 模式说明：

- Relay 模式可以自动安装，前提是本机 Gateway HTTP 仍绑定 `127.0.0.1`。
- Relay 模式下链路是：手机/Web -> 云端 Relay，本机 Gateway -> outbound 连接 Relay，Claude hook -> `127.0.0.1:<port>`。hook 数据不需要暴露到云端。
- Direct/LAN 模式如果 Gateway 绑定 `0.0.0.0` 或局域网 IP，默认不静默自动安装，只打印跳过原因或要求显式确认。

## TODO

- [ ] 采样前置
  - 配置 Claude Code `Stop` hook，把 stdin JSON 采样到本机临时 debug 文件或 debug endpoint。
  - 确认 Tether 当前启动方式 `claude -p --output-format stream-json --verbose --include-partial-messages` 会触发 `Stop` hook。
  - 已实测：Claude Code `2.1.141` 在上述启动方式下会触发 `Stop` hook；`--include-hook-events` stdout 中可见 `hook_event:"Stop"`。
  - 确认 hook stdin 是否包含 `context_window.used_percentage` 和 `rate_limits.five_hour / seven_day`。
  - 确认 hook wrapper 能否拿到 Tether 注入的 `TETHER_SESSION_ID`；如果不能，再评估 hook stdin 的 `session_id / transcript_path` 是否可稳定匹配。
  - 如果无法稳定拿到 Tether session identity，本期停止在采样结论，不实现指标注入。

- [ ] Hook 安装
  - 不新增 `tether hooks install claude` / `tether hooks uninstall claude` 命令。
  - 在 `tether start` 成功拿到 Gateway host/port 后，自动检查/安装/更新 Tether-managed Claude hook。
  - 把 Tether hook wrapper 安装到 `~/.tether/hooks/claude-hud-hook.js`。
  - 使用当前 Gateway host/port 生成 hook endpoint。
  - 只维护 Tether 标记的 hook block，不覆盖用户已有 hook。
  - 支持端口变化时幂等更新。
  - 支持 Tether config 禁用自动安装。
  - 明确 relay 模式在 Gateway HTTP 绑定 `127.0.0.1` 时允许自动安装。

- [ ] `packages/protocol/src/index.ts`
  - 补齐 `agent.result.rateLimitInfo` 类型，加入 `primary / secondary / planType`。
  - 把旧字段 `resetsAt / rateLimitType / status` 改成 optional。
  - 如采用 `contextUsedPercentage`，同步扩展 `agent.result` 类型。

- [ ] `apps/gateway`
  - 新增本机 hook endpoint：`POST /api/hook/claude/context`。
  - 如果主 Gateway 可能绑定非回环地址，hook endpoint 应使用独立 `127.0.0.1` listener，或在路由层严格拒绝非回环来源。
  - 只缓存白名单指标，不保存完整 JSON。
  - 在 `CliChatRunner.run()` 的 `spawn` 前，给 Claude provider 的 env 注入 `TETHER_SESSION_ID=sessionId`。
  - hook 到达时必须按 Tether session identity 匹配 Tether chat session。
  - 为按 session 隔离的 hook 指标增加 TTL，建议 60 秒。
  - 实现 `metricsBySessionId + waitersBySessionId`，同时覆盖 hook 先到和 result 先到两种时序。
  - 在 Claude `finishResult` 时只等待并合并同 session 的 hook 指标。
  - 为 hook 等待设置 bounded wait，建议 300-800ms。
  - 无法匹配 session 的 hook 指标不得注入任何 `agent.result`。
  - 保留现有 `stream-json` result 的 `contextWindow / contextInputTokens` fallback。

- [ ] `apps/relay`
  - `agent.result` 透传 `contextUsedPercentage`。
  - 保持 `rateLimitInfo.primary / secondary` 原样透传，不降级成旧 `resetsAt / rateLimitType / status` 类型。

- [ ] `apps/server`
  - `runtimeSyncRepository` 写入 `usage_json.contextUsedPercentage`。
  - `chatRepository` / message history 响应保留 `contextUsedPercentage`。
  - 刷新页面后 Web 仍能从历史消息恢复 HUD 指标。

- [ ] `apps/web`
  - 复用现有 `ProviderUsageRows`。
  - `ChatHistoryUsage` 增加 `contextUsedPercentage?: number`。
  - 支持优先读取 `contextUsedPercentage`。
  - `primary` 显示为 Usage，`secondary` 显示为 Weekly。
  - Usage 行可在没有百分比但有 reset 时间时继续展示倒计时；Weekly 行仍要求 `usedPercent + resetsAt` 都存在。
  - live WS 不能再要求 `contextWindow` 存在才更新 `usageStats`；只要 `contextUsedPercentage` 或 `rateLimitInfo` 任一存在就要更新。
  - 历史回放 `usageStatsFromHistory()` 不能再因为缺少 `contextWindow` 直接返回 `undefined`；应优先读取 `contextUsedPercentage`，再 fallback 到 `contextWindow + contextInputTokens`。

- [ ] 测试
  - Gateway 单测：hook payload 只提取白名单字段。
  - Gateway 单测：hook payload 携带 Tether session identity 时能匹配到正确 Tether session。
  - Gateway 单测：无法匹配 session 的 hook 指标不会注入 `agent.result`。
  - Gateway 单测：A/B 两个 Claude session 并发时，A 的 hook 指标不会注入 B。
  - Gateway 单测：hook 先于 result 到达时，`finishResult` 能直接合并已缓存指标。
  - Gateway 单测：hook 晚到时 `finishResult` 最多等待 bounded wait，超时后不阻塞 `agent.result`。
  - Gateway 单测：过期 hook 指标不会注入 `agent.result`。
  - Gateway 单测：主 Gateway 绑定 `0.0.0.0` 时，hook endpoint 仍拒绝非回环来源或只监听 `127.0.0.1`。
  - Relay 单测：`contextUsedPercentage` 和 `rateLimitInfo.primary / secondary` 透传到 Client 和 Server sync。
  - Server 单测：`usage_json.contextUsedPercentage` 可写入并通过历史消息读回。
  - Protocol 类型检查覆盖 `primary / secondary`。
  - Web 单测或最小组件验证：无 `contextWindow` 但有 `contextUsedPercentage / primary / secondary` 时，也能正确渲染 Context / Usage / Weekly。

## 验收

代码级验收：

- `pnpm typecheck` 通过。
- Gateway 相关测试通过。
- Web 相关测试或最小验证通过。

人工验收：

1. 配置 Claude Code `Stop` hook 指向本机 Gateway。
2. 在 Web Chat 里发起一次 Claude 回复。
3. 回复完成后，会话状态区能看到：
   - Context 百分比
   - Usage 百分比和重置倒计时
   - Weekly 百分比和重置倒计时
4. 关闭 hook 后，Web 至少还能回退显示当前已有的 Context 计算结果，或者干净地隐藏缺失指标。
5. 同时启动两个 Claude chat session，确认两个会话的 Context / Usage / Weekly 不串值。
6. 刷新页面后，从 Server 历史消息恢复出的会话状态区仍能显示最近一次 HUD 指标。
7. Gateway 端口变化后，Tether-managed Claude hook 能自动更新到新端口，且不会重复追加 hook。

## 未决问题

- hook wrapper 是否能拿到 Tether 注入的 `TETHER_SESSION_ID`？这是实现注入逻辑前的阻塞项。
- `context_window.used_percentage` 是否在所有目标 Claude Code 版本里稳定存在？需要用当前本机版本实际采样确认。
- endpoint 路径是否应该放进 Gateway 内部 API 分组，还是单独作为本机 hook 分组，后续实现时再定。
