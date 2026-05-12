# apps/cli AI 协作规范

本文件记录 `apps/cli` 的目录职责、修改边界和文档回写要求。进入 CLI 代码前，先阅读根目录 `AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`AI_CONTEXT.md`，再阅读本文件。

## 模块定位

`apps/cli` 是用户本机命令入口，负责 commander 命令分发、本机 Gateway supervisor 操作、登录凭据管理、短生命周期 Relay 请求，以及终端 attach。

CLI 不作为 session、权限、账户或 Gateway ownership 的事实源：

- session 创建、输入、停止、订阅和回放的运行时事实源在 Gateway / Relay / Server。
- CLI 只做本机入口编排，不复制 Gateway 的 session catalog、权限判断或 provider runtime。
- CLI 可以校验本机前置条件和展示中文错误，但不能绕过 Gateway/Relay 的认证与隔离规则。

长期架构事实以根目录 `AI_CONTEXT.md` 为准；本文件只补充 CLI 模块内的落地规则。

## 当前目录职责

```text
apps/cli/src/
  main.ts                  # Node 版本兜底、Command 初始化、注册 commands、parseAsync

  commands/                # 用户可见命令注册层，只做参数读取和调用下层能力
    login.ts               # tether login
    logout.ts              # tether logout
    start.ts               # tether start
    stop.ts                # tether stop / stop <id> / stop --all
    restart.ts             # tether restart
    status.ts              # tether status
    run.ts                 # tether run <provider> [providerArgs...]
    ls.ts                  # tether ls
    debug.ts               # tether debug 交互菜单
    serve.ts               # hidden launchd daemon 入口

  gateway/                 # 本机 Gateway supervisor / 状态 / 诊断，不实现 Gateway runtime
    supervisor.ts          # launchd start/stop/foreground serve、启动认证检查
    status.ts              # status 输出和格式化
    doctor.ts              # doctor 检查、provider 命令检查、验证链路
    logs.ts                # Gateway 日志查看
    probe.ts               # Gateway HTTP 探测、ready 等待
    urls.ts                # Gateway URL 归一化

  auth/                    # 本机 Gateway auth/device 文件读写和登录流程
  relay/                   # Relay 短请求：list/create/stop，不承载长连接 attach
  attach/                  # PTY attach 长连接，独立持有 WS 生命周期
  utils/                   # 通用小工具；禁止放业务事实源
    logger.ts              # 结构化日志，写 ~/.tether/logs/cli.YYYY-MM-DD.json

  launchd.ts               # macOS launchd plist/install/start/stop/status 基础设施
  terminal.ts              # CLI 输出样式和状态文案
```

## 日志规范

CLI 使用 `src/utils/logger.ts` 统一写日志，文件路径为 `~/.tether/logs/cli.YYYY-MM-DD.json`，保留最近 7 天。

**调用方式**

```ts
import { logger } from '../utils/logger.js'
logger.info('module', 'msg', { key: value })
logger.warn('module', 'msg', { key: value })
logger.error('module', 'msg', { key: value })
```

**日志格式（每行一个 JSON）**

```json
{"ts":"2026-05-13T10:00:00.123Z","level":"info","app":"cli","module":"cmd","msg":"command invoked","command":"run"}
```

**已有打点位置**

| module | level | 事件 |
|---|---|---|
| `cmd` | info | 命令调用（命令名，不含参数） |
| `cmd` | error | 命令未捕获异常 |
| `attach` | warn | attach 断开，重连中 |
| `attach` | error | attach auth 失败 |

**规则**

- CLI 日志只写文件，不写 stderr（交互终端用户可见，不重复）。
- 不记录命令参数（可能含路径、密码等敏感内容）。
- `initLogger()` 在 `main.ts` 顶部调用一次，其他地方不重复调用。

## 边界规则

- `main.ts` 必须保持薄入口：不写业务逻辑、不直接访问文件系统、不直接发 Relay/Gateway 请求。
- `commands/*` 只注册命令、解析参数、组合调用；复杂逻辑下沉到 `gateway/`、`auth/`、`relay/`、`attach/`。
- `relay/sessions.ts` 只处理短生命周期 Relay 请求：`listSessionsViaRelay`、`createSessionViaRelay`、`stopSessionViaRelay`。
- `attach/pty-attach.ts` 只处理长生命周期全双工 attach：认证、subscribe、stdin/stdout、resize、reconnect、detach/stop。
- 不新增泛化 `relay/client.ts`，避免把短请求和长连接硬抽象成同一个生命周期。
- `gateway/*` 只能操作本机 supervisor、状态探测和诊断；不要在 CLI 里实现 Gateway runtime、session runner、provider process manager。
- 新增 provider runtime、Relay frame 协议或 session ownership 规则时，优先改 `apps/gateway` / `packages/protocol` / `apps/server`，CLI 只消费契约。
- 外部命令必须使用列表参数；禁止 `shell:true` 拼字符串。
- CLI 输出默认中文；命令名、路径、配置键、错误原文可以保留英文。
- **CLI 默认不允许直接调用 HTTP 接口**，session 操作、relay 路由、业务数据读写必须通过本机 Gateway 或 Relay WS，不得绕过直接请求 Server。允许的例外：本机 Gateway 探测（`gateway/probe.ts`）、auth token refresh（`auth/gateway-auth-store.ts`）。新增 HTTP 调用前必须说明为什么不能走 Gateway / Relay。

## 测试与验收

CLI 改动至少跑：

```bash
pnpm --filter @tether-labs/cli typecheck
pnpm --filter @tether-labs/cli test
pnpm tether --help
```

涉及 release 入口、launchd、`serve`、`run`、`attach` 或文件迁移时，加跑：

```bash
pnpm build:release
release/bin/tether --help
```

涉及发布包内容时，再在 `release/` 下跑：

```bash
npm pack --dry-run
```

## 文档回写规范

必须回写：

- CLI 命令入口、命令语义、启动方式、常驻 Gateway 路径发生长期变化：更新 `AI_CONTEXT.md` 和相关 `docs/current/*`。
- `apps/cli/src` 目录职责或模块边界变化：更新本文件；如果影响仓库级模块规范，同时更新 `AI_CONTEXT.md` 的"模块级 AI 规范"和"仓库结构（当前）"。
- Relay / Gateway / Client 协议字段变化：更新 `packages/protocol` 相关类型、`AI_CONTEXT.md` 架构事实，并检查 `apps/gateway/CLAUDE.md` 是否同步。
- 发布入口、release build、launchd plist 行为变化：更新本文件和对应 current 文档。

不需要回写到长期文档：

- 单个 bug fix、局部重命名、测试断言调整。
- 只影响当前施工的临时计划；这类内容写入 `.planning/` 或 `docs/working/`。
- 没有改变用户命令、协议、目录边界或事实源的内部清理。

如果当前实现和 `AI_CONTEXT.md` 不一致，不能只改代码；必须同步修正文档，或明确指出冲突并等待确认。
