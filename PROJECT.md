# 项目协作规则

## 默认阅读范围

开始编码前默认只读：

- 根目录 `AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`AI_CONTEXT.md`
- `docs/current/` 下与任务直接相关的文档
- `docs/working/` 下相关草稿（仅当任务对应未立项的探索阶段）
- `openspec/specs/` 下与任务直接相关的规格
- `openspec/changes/<name>/` 下单个与任务直接相关的活跃变更（仅当它存在时）
- 实际将被修改的源码文件

默认不要扫描依赖、构建产物、缓存、测试输出或大型归档目录。

默认冻结/忽略的内容（仅当用户明确要求历史背景时才读取）：

- `node_modules`
- `dist`
- `.tether/`（运行时数据目录）
- `coverage`
- `logs`
- `openspec/changes/archive`

只有在定位问题、追踪调用链或确认影响面时，才允许扩大搜索范围。扩大范围时
应说明原因。

## 修改代码前的最小检查

修改代码前必须完成以下检查：

- 确认目标文件的现有实现。
- 确认目标代码的主要调用点。
- 查看相邻测试，或同类模块的既有写法。
- 说明准备改什么，以及为什么只改这些地方。
- 如果是 bugfix，先找复现路径；能写测试时，先写失败测试再修复。

如果无法找到调用点或复现路径，必须说明缺口和剩余风险。

## 测试和验证门槛

不能用"理论上没问题"替代验证。

- 单文件小改：至少跑受影响范围内的最小闭环（相关测试、lint、typecheck）。
- API、数据模型、共享类型、跨模块改动：必须跑相关测试和类型检查。
- 终端 / 子进程交互改动：在本地实际起 Gateway + PTY event stream 验证一次端到端，
  不能仅依赖单元测试。
- OpenSpec change 实现：按 `tasks.md` 的验收项逐项验证。
- 如果无法运行验证，必须明确说明：没跑什么、为什么没跑、残余风险是什么。

## 安全门槛（项目专属）

Tether 直接控制本机命令行，安全是底线，必须始终遵守：

- 子进程调用一律走 `child_process.spawn(cmd, args[])`，**绝不**使用 `shell:true`。
- daemon 默认监听 `127.0.0.1`，仅在用户显式 pair / 显式开启 `--host` 时才暴露。
- WebSocket 写操作必须通过 HTTP 换一次性 ticket 后连接；公网/device token
  认证仍按后续 pairing 设计补齐。
- 终端输出向手机/Web 客户端外发前要做基础敏感信息掩码（已知 API Key 格式、
  常见 token 格式）。
- 不让任何客户端能让 daemon 执行任意 shell 命令；客户端只能 `send-keys`
  到既有 agent 进程，不能新建任意进程。

## 文档回写规则

文档按生命周期分层，每层只承担一个职责：

```text
docs/working/ → openspec/changes/<name>/ → openspec/specs/<capability>/ → 根目录长期文档
   (起草)         (施工)                     (长期能力契约)              (AGENTS.md / AI_CONTEXT.md / PROJECT.md)
```

新增长期有效事实时，必须同步更新长期文档：

- AI 协作规则、通用命令、仓库结构、架构约定：更新 `AGENTS.md` 和 `AI_CONTEXT.md`。
- 项目专属规则和约束：更新 `PROJECT.md`。
- 长期能力契约：更新 `openspec/specs/`。
- 当前施工过程、临时决策、阶段性任务：写入对应 `openspec/changes/<change-id>/`，
  不要污染长期文档。
- 当前实现和既有文档不一致时，不能只改代码；必须同步修正文档，或明确指出
  冲突并等待确认。

## 包管理与命令

- 包管理器：**pnpm**
- 运行时：Node.js 20+ LTS
- TS 直跑：`tsx`（不打包到 dist）

常用命令：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm tether --help
pnpm tether gateway
pnpm tether codex
pnpm tether run codex --no-attach
pnpm tether attach <id> --control
pnpm tether attach <id> --observe
pnpm tether clients <id>
pnpm tether stop <id>
pnpm tether codex --host 0.0.0.0
pnpm tether codex --transport tmux
```

`--host 0.0.0.0` 仅用于可信局域网调试。当前 WS 有一次性 ticket，但还没有完整
device token / pairing；不要直接暴露到公网。

## 编辑器/AI 工具配套

- AI 上下文规则文件位于仓库根目录（`AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、
  `AI_CONTEXT.md`），多 AI 客户端共享同一份事实来源。
- 不要为单一 AI 客户端创建专属规则文件分支；所有规则统一回写到上述四份。
