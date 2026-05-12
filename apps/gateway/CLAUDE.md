# Tether Gateway 模块规范

本文约束 `apps/gateway`。根级长期事实见 `../../AI_CONTEXT.md`，共享编码原则见
`../../CLAUDE.md`，项目命令和安全要求见 `../../PROJECT.md`。

`apps/gateway` 是本机 Gateway runtime：负责本机 HTTP 壳、Relay Gateway WS、
PTY runner 控制、Chat CLI runner、session 目录合并和事件转发。它是一个 app，
但内部必须按 Relay / PTY / Chat 分层维护。

## 入口顺序

修改 `apps/gateway` 前先读：

1. 根目录 `AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`AI_CONTEXT.md`
2. 本文档
3. 当前任务涉及的 `docs/current/` 文档
4. 实际要改的源码和对应测试

## 当前职责边界

```text
daemon.ts                       本地 Hono HTTP 壳、status、web dist、Relay client 启动、
                                Gateway auth heartbeat、onNewPtySession 注入
registry.ts                     Gateway 注册表：写/读 ~/.tether/gateways/ 下的 Gateway 记录
relay-client.ts                 Relay WS transport：连接、认证、心跳、重连、send/parse frame

relay/frame-router.ts           按 frame.type 分发到 handler
relay/relay-sender.ts           封装向 Relay 发送 frame 的方法
relay/chat-handler.ts           Chat 业务 frame 处理
relay/pty-handler.ts            PTY 业务 frame 处理
relay/session-catalog.ts        chat + PTY session 合并、restore、lost、list
relay/subscription-manager.ts   订阅状态、chat catchup、PTY replay/live subscribe

pty/manager.ts                  PtySessionManager，内存 session registry + legacy/local PTY path
pty/session-runner.ts           detached per-session runner 主类，持有真实 PTY 和 provider child
pty/session-runner-spawn.ts     spawn detached session runner 进程
pty/session-runner-process.ts   在子进程中运行 SessionRunner 的入口
pty/session-runner-client.ts    连接 runner Unix socket 的 IPC 客户端
pty/session-runner-detach-fixture.ts
                                测试用 detach fixture
pty/session-status-deriver.ts   从 PTY events 派生 AgentRuntimeStatus
pty/replay.ts                   PTY event replay 过滤（按 id/tail 筛选）
pty/agent-select-detector.ts    Claude PTY 输出中的 select prompt 检测
pty/node-flags.ts               Node runtime 启动参数常量，保持 launcher/runner 一致

chat/chat-runtime.ts            Chat runtime 入口，持有 ChatSessionRegistry，实现 frame 处理接口
chat/chat-session-runner.ts     Chat CLI runner，处理 claude/codex/copilot chat 模式
chat/chat-session-registry.ts   Chat session 内存注册表
chat/provider-registry.ts       provider 列表、model discovery、cwd suggestion
chat/provider-utils.ts          provider 路径、home 目录解析等工具函数
chat/providers/                 各 provider adapter（claude / codex / copilot）

utils/events.ts                 Gateway session event 构造
utils/gateway-auth.ts           Gateway 认证工具
utils/ids.ts / mask.ts / provider-env.ts / package-version.ts
                                共享工具函数

types.ts                        Gateway runtime 类型
```

## 目录分层（已落地）

```text
src/relay/                 Relay frame 分发、发送封装、session catalog、订阅管理、
                           chat handler、pty handler
src/pty/                   PTY manager、runner、runner client、spawn、agent.select detector、
                           replay、status deriver
src/chat/                  Chat runner、chat session registry、provider registry、provider adapters
src/utils/                 共享工具函数
```

目录已按目标结构落地。新增文件须归入对应层，不得在 `src/` 根目录堆业务代码。

## Relay 边界

Relay 层负责 Gateway WS 和 frame 编排。

允许：

- 连接、认证、心跳、重连、关闭。
- 根据 frame type 分发到 Chat / PTY / subscription / catalog。
- 发送 `gateway.event`、`gateway.error`、`gateway.sessions`。
- 维护 client 订阅状态。
- 合并 Chat / PTY session 列表。

禁止：

- 在 `relay-client.ts` 继续新增 Chat 业务逻辑。
- 在 `relay-client.ts` 继续新增 PTY 控制逻辑。
- 在 frame router 里直接 spawn provider 或直接写 PTY。
- 绕过 Relay 多租户 scope / gatewayId / session ownership 校验。
- 通过 HTTP 接口向 Server 做 session 查询、路由或业务操作——session 相关控制必须走 Relay WS frame，不得绕过 Relay 直接 HTTP 到 Server。
  （允许的例外：auth heartbeat、gateway token refresh、外部 provider API 调用。）

## PTY 边界

PTY runtime 负责真实终端和 runner 控制。

允许：

- `client.input` 写入 runner 或 local PTY。
- `client.resize` 调整 runner 或 local PTY。
- `client.stop` 停止 runner 或 local PTY。
- `client.new-pty-session` 通过 daemon 注入的 `onNewPtySession()` 创建新 session。
- runner socket 不可达时标记 `lost` 并发 `session.error`。

禁止：

- `pty-handler` 自己维护订阅表。
- `pty-handler` 自己判断账号、gatewayId 或 session scope。
- `pty-handler` 直接信任客户端传来的 `command` 来 spawn 进程。
- `RelayClientOptions.onNewPtySession` 暴露或传递客户端提供的 `command` 字段。
- PTY 层处理 `client.chat`、`permission_response`、provider list 或 cwd suggest。
- 恢复本地 SQLite / Store。

`client.new-pty-session` 允许从客户端带 provider、cwd、尺寸、title 和 providerArgs，
但实际可执行命令必须由 daemon/config/provider 白名单决定。未来重构时应删除
`onNewPtySession` 类型中的 `command` 字段，避免后续实现者误用客户端输入。

runner socket 写入、resize、stop 失败时，不能只给当前 client 发送 `gateway.error`。
如果失败代表 runner 丢失，必须更新 session 状态并发送 `gateway.event` 包装的
`session.error`，让其他订阅者也能感知失联。

PTY 控制动作必须先通过 subscription 层的 control-mode 检查。错误语义必须保持：

| 条件 | 错误 |
| --- | --- |
| 未订阅 | `not_subscribed` |
| observe 模式 | `observe_only` |
| session 不存在 | `session_not_found` |
| PTY runner 不可达 | `session_lost` |

## Chat 边界

Chat runtime 负责无 PTY 的 CLI chat 模式。

允许：

- 新建 chat session。
- 续聊 existing chat session。
- 维护 chat session registry。
- 维护同 session in-flight 锁。
- 处理 `permission_response`。
- 处理 provider list、cwd suggest、当前未实现的 switch-model 响应。

禁止：

- Chat 层调用 PTY `write` / `resize` / `stop`。
- 续聊时使用 Web 直接传来的可执行 metadata。
- Chat session 写本地 SQLite。
- 把 chat event 存到 Gateway 本地 DB。

Existing chat 续聊必须使用 Relay 注入的 trusted metadata。

`permission_response` 必须要求 client 已订阅该 session。未订阅 client 发送回复时应返回
`not_subscribed`，不能转发给 provider runner。

## Subscription 边界

`client.subscribe` 是 Chat / PTY 共享入口，不属于单纯 PTY。

Subscription 层负责：

- `client.subscribe`
- `client.unsubscribe`
- `client.detach`
- Chat catchup
- PTY replay stub
- PTY live event subscribe
- `agent.select` 检测触发
- 给 PTY handler 提供 `requireControlSession()`

不要把 subscribe 逻辑直接塞进 `pty-handler`。

## Session Catalog 边界

Session catalog 是共享层，负责：

- 合并 Chat sessions 和 PTY sessions。
- `gateway.sessions-restore` 远端恢复。
- `toRelaySession()` 转换。
- `lost` 过滤。
- restored session 保留。
- runner 活性检查。

不要让 Chat handler 或 PTY handler 各自拼 session list。

## 本地 SQLite 禁止恢复

Gateway 当前运行态应依赖：

- `PtySessionManager` 内存 Map。
- detached runner socket。
- Relay / Server / MySQL runtime sync。

禁止新增：

- `apps/gateway/src/store.ts`
- `better-sqlite3`
- `DatabaseSync`
- `store.appendEvent`
- `store.insertSession`
- `session_events` 本地写入
- `sessions` 本地写入

如果发现旧 SQLite 相关启动参数、测试命名或文档残留，应作为清理项处理，不得作为新实现依赖。

## 日志规范

Gateway 使用 `src/utils/logger.ts` 统一写日志，文件路径为 `~/.tether/logs/gateway.YYYY-MM-DD.json`，保留最近 7 天。

**调用方式**

```ts
import { logger } from './utils/logger.js'
logger.info('module', 'msg', { key: value })
logger.warn('module', 'msg', { key: value })
logger.error('module', 'msg', { key: value })  // 同时写 stderr
```

**日志格式（每行一个 JSON）**

```json
{"ts":"2026-05-13T10:00:00.123Z","level":"info","app":"gateway","module":"relay","msg":"connected","gatewayId":"gw_xxx"}
```

**已有打点位置**

| module | level | 事件 |
|---|---|---|
| `daemon` | info | 启动就绪、关闭 |
| `daemon` | warn | session 启动时 lost、server heartbeat 失败 |
| `daemon` | info | PTY session 创建成功（relay 触发） |
| `relay` | info | connecting、connected、disconnected、reconnecting |
| `relay` | error/warn | auth 永久/暂时失败、server 拒绝 auth |
| `pty` | warn | session marked lost |
| `pty` | error | session create failed |
| `chat` | info | session started、session ended |
| `chat` | error | runner spawn failed、runner exit with error |

**规则**

- 新增关键运维事件必须打日志；高频事件（每帧、每次 ping）禁止打日志。
- 日志字段不得包含完整 token、密码、终端输出原文等敏感内容。
- `initLogger()` 在 `startDaemon()` 入口处调用，其他地方不重复调用。

## 子进程安全

Gateway 能控制本机命令，安全要求高于普通服务端代码。

- 子进程必须使用 `spawn(command, args[])`。
- 禁止 `shell:true`。
- 禁止拼 shell 字符串执行用户输入。
- provider 必须走白名单和 config。
- 客户端不能让 Gateway 执行任意 command/env。
- 终端输出外发前必须做敏感信息掩码。

## 修改前自检

修改 `apps/gateway` 前至少确认：

1. 这次改动属于 Relay transport、session catalog、subscription、PTY runtime、Chat runtime、daemon 哪个边界？
2. 是否影响 Relay / Gateway / Client 协议类型？
3. 是否影响 `accountId` / `gatewayId` / `sessionId` ownership？
4. 是否影响 `control` / `observe` 权限？
5. 是否影响 runner socket fallback 或 lost 标记？
6. 是否影响 Chat trusted metadata 或 in-flight 锁？
7. 是否需要同步修改 `packages/protocol`、`apps/relay`、`apps/web`、`apps/cli`？
8. 最小测试命令是什么？

## 反模式速查

| 禁止行为 | 正确做法 |
| --- | --- |
| 在 `relay-client.ts` 继续堆业务分支 | 拆到 `src/relay/*` handler |
| 把 `client.subscribe` 归到 PTY handler | 放到 subscription manager |
| PTY handler 复制订阅 / observe 判断 | 调 subscription manager 的 control 检查 |
| Chat handler 调 PTY write/resize/stop | Chat 和 PTY 控制面隔离 |
| 续聊 chat 信任 Web metadata | 只用 Relay 注入的 trusted metadata |
| 未订阅 client 能发送 `permission_response` | 先检查订阅状态，不满足返回 `not_subscribed` |
| Gateway 重新引入 SQLite Store | 用内存 + runner socket + Relay/Server sync |
| 客户端 command 直接用于 spawn | daemon/config/provider 白名单决定 command |
| runner socket 失败只返回错误不标记 lost | 更新 session 状态并发送 `session.error` |
| 只改 Gateway 不跑 Relay 相关测试 | 涉及 frame/scope 时同步跑 relay 测试 |
| Gateway 通过 HTTP 调 Server 做 session 操作 | session 控制必须走 Relay WS frame |

## 验证

Gateway 改动至少执行：

```bash
pnpm --filter @tether/gateway typecheck
```

影响 Relay client、frame 分发、Chat 或 PTY runtime 时执行：

```bash
pnpm --filter @tether/gateway test -- relay-client.test.ts
pnpm --filter @tether/gateway test -- chat-session-runner.test.ts
pnpm --filter @tether/gateway test -- session-runner.test.ts
pnpm --filter @tether/gateway test -- pty.test.ts
```

影响 PTY event replay 或 status 派生时执行：

```bash
pnpm --filter @tether/gateway test -- replay.test.ts
pnpm --filter @tether/gateway test -- session-status-deriver.test.ts
```

影响 agent.select 检测时执行：

```bash
pnpm --filter @tether/gateway test -- agent-select.test.ts
```

影响 daemon HTTP 壳或 Gateway 注册表时执行：

```bash
pnpm --filter @tether/gateway test -- daemon.test.ts
```

影响 Relay routing、scope、gatewayId、session ownership 或 protocol frame 时执行：

```bash
pnpm --filter @tether/relay typecheck
pnpm --filter @tether/relay test -- relay.test.ts
```

影响 CLI 创建、attach、stop、debug 时执行：

```bash
pnpm --filter @tether-labs/cli typecheck
```

影响真实 PTY / runner 行为时，除了单测和 typecheck，还要做一次人工 UAT。

## 回写规则

本文档跟随代码演进，AI 和人工改动后必须同步更新。

**触发更新的条件**

| 变化 | 必须更新的部分 |
|---|---|
| 新增 src 文件 | "当前职责边界"文件列表 + 对应层描述 |
| 删除或重命名 src 文件 | 同上 |
| 新增禁止行为或允许行为 | 对应层的"允许/禁止"列表 + "反模式速查"表 |
| 新增测试文件 | "验证"部分对应触发条件 |
| 层职责边界变化 | "当前职责边界"描述 + 对应层小节 |
| 新增 Protocol frame 类型 | "修改前自检"第 2 条涉及的影响面 |

**不需要更新的内容**

- 正在进行中的 working 文档引用（working 完成后应从入口顺序中删除该引用）
- 具体 bug 修复或重构细节（属于 git commit message 的范畴）
- 测试用例内部逻辑

**更新原则**

- 只改与本次变化直接相关的部分，不顺手整理无关内容。
- 描述保持和代码实际一致，不写"计划中"或"后续"等意图性表述。
- 若新文件职责不能归入现有层，先说明为什么，再决定是否新增层。
