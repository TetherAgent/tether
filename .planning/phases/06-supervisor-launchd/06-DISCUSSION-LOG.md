# Phase 6: Supervisor & launchd - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 6-Supervisor & launchd
**Areas discussed:** CLI 转发策略, 常驻 Gateway 配置, launchd 安装体验, 失败与重启语义, Phase 6 范围边界

---

## CLI 转发策略

| Option | Description | Selected |
|--------|-------------|----------|
| 默认转发到常驻 Gateway | `tether codex` / `tether run codex` 先找后台 Gateway 创建 session | ✓ |
| 显式 flag 才转发 | 需要用户额外指定才走常驻 Gateway | |
| Gateway 不在时失败 | 找不到 Gateway 就报错退出 | |
| Gateway 不在时 inline fallback | 找不到 Gateway 时回到当前 inline 模式，并提示用户 | ✓ |
| `--inline` | 强制旧 inline 模式，方便调试 | ✓ |

**User's choice:** 默认先找常驻 Gateway；找不到就 inline fallback；增加 `--inline`。  
**Notes:** 用户希望还有默认 Gateway 启动方式，最终锁定 `tether gateway` 前台运行、`tether gateway start` 后台运行。

---

## 常驻 Gateway 配置

| Option | Description | Selected |
|--------|-------------|----------|
| CLI 参数 | 每次命令传 `--host --port --relay-url --relay-secret` | ✓ |
| 环境变量 | 继续支持 `TETHER_RELAY_URL` / `TETHER_RELAY_SECRET` 等 | ✓ |
| `~/.tether/config.js` | 可执行 JS 配置 | |
| `~/.tether/config.json` | 数据配置，不执行代码 | ✓ |
| 默认值 | 未配置时用默认 host/port | ✓ |

**User's choice:** 使用 JSON 配置。配置优先级为 CLI 参数 > 环境变量 > `~/.tether/config.json` > 默认值。  
**Notes:** 用户确认如果 Phase 4/5 中有冲突配置，应放到 Phase 6，后续从 Phase 4/5 去除。

---

## launchd 安装体验

| Option | Description | Selected |
|--------|-------------|----------|
| `tether gateway` | 前台运行，开发调试用 | ✓ |
| `tether gateway install` | 只注册 launchd 登录自启 | ✓ |
| install 后立刻启动 | 安装时立即启动后台 Gateway | |
| `tether gateway start` | 后台启动 Gateway | ✓ |
| `tether gateway stop` | 停止后台 Gateway | ✓ |
| `tether gateway restart` | 重启后台 Gateway | ✓ |
| `tether gateway status` | 中文显示状态 | ✓ |
| npm registry 发布 | 正式发布到 npm | |
| 本机全局 `tether` 命令 | 支持个人机器全局命令和 launchd 绝对入口 | ✓ |

**User's choice:** `install` 只注册下次登录启动；后台运行用 `start/stop/restart`；`gateway start` 可以自动确保 plist 已存在；状态输出中文；本期需要本机全局命令，不要求 npm 发布。  
**Notes:** launchd plist 不能依赖 `pnpm tether`、当前工作目录、shell 环境或 `$HOME` 展开，必须写绝对入口。

---

## 失败与重启语义

| Option | Description | Selected |
|--------|-------------|----------|
| 3 次重试 / 500ms | Gateway 可能正在重启时短暂等待 | ✓ |
| 直接失败 | 第一次连不上就退出 | |
| fallback inline | 重试失败后回到当前 inline 模式并中文提示 | ✓ |
| 自动换端口 | 默认端口占用时自动寻找新端口 | |
| 端口冲突报错 | 非 Tether 进程占用端口时中文报错 | ✓ |
| Relay 断线不阻塞本地 | 本地 session 创建继续，状态页显示 Relay 未连接 | ✓ |
| Relay 精确连接状态 | 低成本可实现时，status 显示 connected/disconnected | ✓ |

**User's choice:** 接受默认建议。  
**Notes:** 失败提示必须让用户知道是 Gateway 重启、端口占用、还是回退到 inline。

---

## Session 创建安全开关

| Option | Description | Selected |
|--------|-------------|----------|
| 默认开启 `POST /api/sessions` | 安装后即可远程/API 创建 session | |
| 默认关闭，需要配置开启 | 默认拒绝 API 创建 session，用户显式开启后可用 | ✓ |
| 允许任意 command/args/env | 作为通用远程执行入口 | |
| 只允许 provider 白名单 | 只能创建 `codex/claude/opencode` 等既有 provider | ✓ |

**User's choice:** 增加配置开关，默认关闭。即使开启，也只能走 provider 白名单，不能接受任意 command/args/env。  
**Notes:** 这是 Phase 6 对 `POST /api/sessions` 的安全边界；Phase 4 后续再接 device token / pairing。

---

## Phase 6 范围边界

| Option | Description | Selected |
|--------|-------------|----------|
| 吸收 Gateway 常驻配置 | 与常驻 Gateway 冲突的配置归 Phase 6 | ✓ |
| 做 device token / pairing | Phase 4 认证内容 | |
| 做 retention / WAL | Phase 5 存储健康内容 | |
| 删除 tmux fallback | Phase 3 cleanup 内容 | |
| 做 npm registry 发布 | 分发打包内容 | |

**User's choice:** Phase 6 吸收 Gateway 常驻配置冲突；不做 Phase 4/5 的 auth/retention；不删 tmux；不做 npm registry 发布。  
**Notes:** Phase 4/5 后续需要按 Phase 6 的配置和常驻 Gateway 事实调整。

## the agent's Discretion

- 具体模块拆分、HTTP API 名称、launchd helper 内部实现由实现阶段按现有代码模式决定。
- 中文提示的精确措辞由实现阶段决定，但必须清楚、可操作。
- `gateway start` 是否要求先 `install`，或自动创建/更新 plist，可在计划阶段按 macOS launchd 约束决定。

## Deferred Ideas

- npm registry 正式发布。
- device-token pairing、设备管理、写接口认证。
- retention、WAL checkpoint、存储清理。
- tmux fallback 删除。
