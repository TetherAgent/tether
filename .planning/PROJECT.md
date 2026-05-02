# Tether — Agent Console

## What This Is

Tether 是一个 **agent 控制台**：把"用户直接运行 codex/claude/opencode"包装成"由
Gateway 托管的 agent 会话"，让任意设备（电脑 CLI、手机 PWA、桌面 Web）拴到同一
个会话上同步看到输出、写入输入、接管控制。本仓库当前是单人长期项目，目标产品
形态是 macOS 本地常驻 Gateway + 多端 attach client。

不是 IDE，不替代 VS Code / Cursor。代码编辑由 agent 执行；用户负责审阅、引导、
批准、调度。

## Core Value

**在 agent session 场景里，本地体验对齐 tmux，并在历史回放、多端接管、审计、
手机/Web/App 接入上超越 tmux。**

任何取舍都先回答这一句：当前改动是否让本地终端手感退步？是否让多端接管能力前
进？

## Active Milestone

**v0.3 — Personal Relay Access**

收尾 Phase 2（PTY-backed event stream），并按个人使用优先把自建 Relay MVP 提前：
先让 Gateway 通过 outbound WSS 连到自托管 Relay，让手机 / Web 不依赖同一 LAN 也能
接入既有 session；随后补齐 detach/TUI 本地体验、owner device token、Gateway
supervisor、retention 和 tmux fallback 下线。

里程碑出口：用户可以从手机 / Web 通过自建 Relay 安全访问运行在 Mac 上的 Gateway，
本地终端体验不退步，Phase 2 验收清单全绿。

## Requirements

### Validated（Phase 2 已落地，2026-05-01）

- ✓ **TRANSPORT-01**: `node-pty` 作为默认 transport；`tether codex/claude/opencode` 走 Gateway-owned PTY — Phase 2A
- ✓ **TRANSPORT-02**: append-only event store（`session_events` 表 + 完整事件 union） — Phase 2A
- ✓ **TRANSPORT-03**: WebSocket stream + cursor replay + live broadcast — Phase 2A
- ✓ **TRANSPORT-04**: 浏览器 WS 通过 HTTP 一次性 ticket 认证；`hello` frame 由 Gateway 分配 `clientId` — Phase 2A
- ✓ **CLI-01**: `tether run / attach / clients / stop` CLI 全集可用 — Phase 2A
- ✓ **CLI-02**: `--control` / `--observe` 模式；`active controller owns size` — Phase 2B
- ✓ **MULTI-01**: 多本地终端窗口 attach 同一 session；controller 接管策略；last input source 展示 — Phase 2B
- ✓ **WEB-01**: Web xterm.js 渲染 PTY 输出 + transcript 兜底 + localStorage cursor — Phase 2A/2B
- ✓ **REPLAY-01**: replay 默认 1000 / 上限 5000 events，超限提示走 transcript — Phase 2B
- ✓ **SAFE-01**: provider 白名单 + binary 由 Gateway 解析；客户端不能传 command/args/env — Phase 2C
- ✓ **SAFE-02**: PTY output 与 user.input 落库前 secret mask；写 PTY 仍用原始 bytes — Phase 2C
- ✓ **SAFE-03**: Gateway 默认仅 `127.0.0.1`，LAN 暴露需显式 `--host 0.0.0.0` — Phase 2C
- ✓ **STATE-01**: Gateway 重启后无法接管的 PTY session 标记为 `lost` — Phase 2B
- ✓ **STRUCT-01**: `approval.requested` / `diff.detected` / `agent.handoff` 占位 event 已加 — Phase 2D
- ✓ **RELAY-01**: 自建 Relay MVP：Gateway outbound WSS 连接 Relay，远端 Web client 可通过 Relay attach/control 既有 session；Relay 只转发认证后的协议 frame，不执行命令、不持久化终端明文 — Phase 1, 2026-05-01

### Active（v0.3 — Personal Relay Access 范围）

**P0 — 个人远程访问与本地体验硬指标**

- [ ] **EXP-01**: 设计并实现 Tether detach 快捷键 / command mode（不复刻 tmux prefix）
- [ ] **EXP-02**: 验证并修复 `Enter / Backspace / Ctrl-C / Ctrl-D` 行为
- [ ] **EXP-03**: 验证并修复 paste / bracketed paste 第一版策略
- [ ] **EXP-04**: 验证 ANSI color / cursor / clear screen / alternate screen 常见行为
- [ ] **EXP-05**: 复杂 TUI（Codex / Claude）启动后的 resize 重排专项修复

**P1 — 安全 & 稳定性硬指标（Phase 2C / 1.5 起步）**

- [ ] **AUTH-01**: input / resize / stop / claim-control 全部接入 owner device token auth
- [ ] **AUTH-02**: 完整 owner device pairing 流程（一次性 code + token hash 落库）
- [ ] **RETAIN-01**: event retention 初版（默认 7 天 / 每 session 100MB，先到先清）
- [x] **GW-01**: `tether gateway` 升级为真 supervisor — 单进程统一持有所有 PTY session
- [x] **GW-02**: macOS launchd / 后台保活方案（评估 + 落地起步）
- [ ] **TEST-01**: auth / provider whitelist / secret mask / 旧接口兼容 / retention 的安全和集成测试

**P2 — Phase 2 收口**

- [ ] **CLEAN-01**: tmux fallback 最终下线，`--transport tmux` 不进入正式产品路径
- [ ] **CLEAN-02**: 评估并决定是否删除 `transport` 字段（或保留为未来扩展点）
- [ ] **CLEAN-03**: 文档说明 Phase 4 才实现完整 diff/approval UI；structured event 类型 exhaustive switch 测试

### Out of Scope（v0.3 不做）

- **Cloudflare Tunnel / Tailscale 集成的工程化适配** — v0.3 优先自建 Relay MVP；tunnel UX 后移
- **Hosted Relay / 多用户账户 / ownership model / 计费 / 控制平面** — v0.3 只做个人自托管 Relay；后续单独做 Multi-user / Hosted Relay / Ownership Model
- **Relay 端到端加密 envelope / push / 高可用运维** — MVP 路由打通后再做生产化
- **Provider 抽象（ACP / JSON-RPC）+ 多 agent 并发** — Phase 3a，独立 milestone
- **多机 federation** — Phase 3b，独立 milestone
- **后台任务 + 推送 + 加密 relay** — Phase 3c，独立 milestone
- **diff / 文件树 / 富权限审阅 UI** — Phase 4，严格放到 v1.0 之后
- **代码补丁编辑器 / 完整代码编辑器 / LSP 集成** — 永久 out of scope（IDE 化滑坡）
- **tmux pane / window / prefix / copy mode / plugin 生态** — 永久 out of scope（不重写通用 multiplexer）
- **任意 shell 命令远程执行** — 永久 out of scope（安全边界硬约束）

## Context

**仓库形态**：pnpm monorepo 雏形已落地。

```
apps/
  cli/            # commander CLI，调用 Gateway API
  gateway/        # Hono + better-sqlite3 + node-pty，session owner
  web/            # React + Vite + xterm.js
packages/
  core/ protocol/ config/ ui/
native/           # 原生客户端预留
docs/             # working/ + current/
.planning/        # 本目录，GSD 流程
```

**已有规则文件**：根目录 `AGENTS.md` / `CLAUDE.md` / `PROJECT.md`（项目协作规则
而非 GSD 项目上下文，与本文件并存）/ `AI_CONTEXT.md` 已就位，规则优先级清楚。

**调试 / 历史**：`docs/working/2026-05-01-phase-2-pty-event-stream.md` 与
`docs/working/2026-05-01-tether-agent-console.md` 是 Phase 2 立项前的全量草案；
本里程碑的 Active 项就是它们里面 `[ ]` 未勾选的硬指标。两份文档继续作为参考，
不再迭代。

**规划流程**：本项目当前使用 GSD 维护阶段计划、执行状态和验收记录；长期有效事实
沉淀到 `docs/current/`、`AI_CONTEXT.md`、`PROJECT.md` 和 `AGENTS.md`。

**单人开发**：业余时间推进，迭代节奏按"硬指标 → 测试 → 文档"，不追求大批量并行。

## Constraints

- **Tech**: Node 20+ LTS / TypeScript / pnpm workspace；运行时直跑 `tsx`，不打包到 `dist`
- **HTTP**: Hono；DB: `better-sqlite3`（同步 API，单进程 Gateway）
- **PTY**: `node-pty` 是 native module，必须保证 macOS 本地构建链可用
- **Security**: 子进程一律 `child_process.spawn(cmd, args[])`，**绝不** `shell:true`；Gateway 默认 `127.0.0.1`
- **Provider 白名单**: 仅 `codex / claude / opencode`，binary 由 Gateway 解析，客户端不能传 command/args/env
- **Secret mask**: PTY output 和 user.input 落库前必走 mask；写 PTY 用原始 bytes
- **测试门槛**: 终端 / 子进程交互改动必须在本地实际起 Gateway + PTY event stream 跑端到端，不能只跑单测
- **平台**: 仅 macOS；Linux / Windows 不在 v0.3 范围
- **存储**: 单机 SQLite at `~/.tether/tether.db`；不引入外部存储依赖

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 用 PTY-backed event stream 替换 tmux 主路径 | tmux 路线的手机/Web/App 天花板太低；event stream 才能落地"超越 tmux"的差异化 | ✓ Good — Phase 2 已落地 |
| `active controller owns size` 作为 resize 仲裁第一版 | 多端尺寸不同，PTY 只有一个 size；强锁太重，自由竞争太乱 | ✓ Good — 已实现并通过验收 |
| 浏览器 WS 用 HTTP 一次性 ticket，不依赖自定义 Authorization header | 浏览器原生 WS 不能设 header；ticket 简单且可日志 mask | ✓ Good — 已实现 |
| `clientId` 由 Gateway 在 `hello` frame 分配 | 防止客户端伪造身份并影响审计 | ✓ Good — 已实现 |
| Provider 白名单 + binary 由 Gateway 解析 | 不允许任意 shell；客户端只传 provider id | ✓ Good — 已实现 |
| Phase 2 收尾原定叫 v0.3 — Remote Access | 原计划先做 LAN + device token + supervisor，再做 relay；现在已被 Personal Relay Access 重排取代 | Superseded |
| v0.3 改为 Personal Relay Access，Relay MVP 提前到 Phase 1 | 当前是个人使用场景，远程可达性比完整产品化认证/多用户更优先；Relay 必须保持只转发、不执行、不持久化明文 | — Pending |
| Phase 4 收窄为 owner device auth | 当前 v0.3 先保护个人设备写入；多用户账号、tenant、Gateway/session ownership、角色、分享和撤销需要独立 ownership model | Deferred to Multi-user / Hosted Relay / Ownership Model |
| Phase 4 IDE 化严格只做只读 review | 写编辑就滑向 IDE；保留控制台定位 | — Pending（v1.0 之后） |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-01 after personal Relay-first reorder*
