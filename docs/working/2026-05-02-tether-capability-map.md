# Tether 能力地图：山峰视角

**状态**：Working  
**记录时间**：2026-05-02  
**用途**：记录项目长期能力地图，作为后续 roadmap / GSD phase 拆分参考。本文不是当前实现事实，也不是执行计划。

## 总判断

Tether 不只是远程终端工具。它最终要形成的是一套 **Agent 操作系统的控制面**：把本机和远程的 agent session 变成可连接、可授权、可审计、可接管、可长期运行的资源。

当前优先级不是先扩更多客户端，而是先让 Mac 上的 agent session 成为一个可靠的控制对象：终端体验稳定、身份边界清楚、Relay 安全、审计完整、协议可复用。

## 一、核心控制链路

这层决定产品能不能成立。

需要补齐：

- 稳定终端控制：detach、reconnect、resize、paste、ANSI、TUI 行为稳定。
- Session 生命周期：创建、查看、接管、观察、停止、lost/recover/replay 行为清楚。
- 多端一致体验：CLI、Web/PWA、Flutter 手机 app、未来桌面/floating console 都围绕同一套 session/event 协议。

判断标准：

- Codex / Claude / opencode 可以长期跑。
- 多端 attach 不乱抢控制权。
- 用户从任何端接管时，看到的是同一个 session，而不是另一个副本。

## 二、身份与访问层

这是个人工具变成产品的门槛。

需要补齐：

- `account -> workspace -> gateway -> session` ownership。
- normal Web/session user 与 management console user 的身份边界。
- `owner` / `admin` / `controller` / `observer` 的产品权限。
- Gateway login / bind / token refresh / revoke。
- device 管理与 revoke。
- Relay / Gateway / Web / Flutter 全部使用同一套授权边界。

判断标准：

- 谁能看哪个 session、谁能输入、谁能 stop、谁能管理 Gateway，都能从 contract 推导出来。
- management token 不自动拥有 terminal/session control 权限。
- revoked token 或 device 不能继续写入。

## 三、Relay 与远程访问

这是“人在外面也能管 Mac 上 agent”的能力。

需要补齐：

- Gateway WS token auth。
- Client WS token auth。
- Relay 按 account/workspace/gateway/session scope routing。
- Relay 永远只转发 frame，不执行命令、不持久化终端明文、不成为 ownership source。
- 连接诊断：Gateway online/offline、Relay connected/disconnected、client latency、token expired、permission denied、session lost。

判断标准：

- 外部客户端通过 Relay 能接管 session。
- 跨账号/跨 workspace 猜 ID 也看不到、控不了。
- 断线和权限失败能给用户清楚原因。

## 四、操作台体验

这是用户每天是否愿意用的部分。

需要补齐：

- Web session console：session list、live terminal、replay、controller/observer、Gateway selector、Relay/LAN connection mode。
- Account Management Console：members、roles、devices、Gateways、audit events、revoke/unlink。
- Flutter App：手机看 session、手机接管输入、Relay 优先、LAN 直连、真实 terminal、HarmonyOS 兼容、Dart SDK 从 `packages/protocol` 生成。

判断标准：

- 用户可以从 Web 或手机完成日常观察、接管、停止、审计。
- 管理员不需要手改数据就能管理成员、设备、Gateway 和审计。

## 五、审阅与批准能力

这是 Tether 与普通 terminal / 远控工具拉开差距的地方。

需要补齐：

- approval surface：agent 请求批准，手机/Web approve/reject，记录谁批准了什么。
- read-only diff / file review：文件树、diff、变更摘要。
- agent handoff：agent 交接当前任务状态，多端看到同一份上下文，用户能中途介入和改方向。

边界：

- 只做审阅和批准，不做完整 IDE。
- 不做代码补丁编辑器、LSP、完整文件编辑。

## 六、可靠性与安全

这是能不能长期跑的底线。

需要补齐：

- retention：event store 限制 7 天 / 100MB per session，WAL checkpoint。
- audit：attach/detach/input/resize/stop/control/auth failure 全部记录身份。
- security tests：跨账号不可见、observer 不能写、revoked token 失效、Relay 不接受任意 command、provider whitelist、secret mask。
- protocol governance：`packages/protocol` 是唯一来源，Web/Relay/Gateway/Server/Flutter 共用契约，Dart SDK/codegen，breaking change 规则。

判断标准：

- 长时间运行不会让 SQLite/WAL 无限膨胀。
- 审计能回答“谁在什么设备上，对哪个 session 做了什么”。
- 协议演进不会让 Web、Server、Relay、Flutter 各写一套事实。

## 七、后续大方向

这些不是当前优先级，但需要保留位置。

- Multi-workspace：创建/切换 workspace，per-workspace member/role/Gateway/session/audit。
- Provider abstraction：ACP / JSON-RPC，多 agent tabs，provider capability model。
- Push notifications：agent 请求批准、session 完成或异常时推送手机。
- Multi-machine federation：多台 Mac/server，Gateway fleet，session 路由。
- Hosted SaaS：账号、计费、团队、审计、托管 Relay。

## 建议推进顺序

当前建议顺序：

1. Phase 2：终端体验硬化。
2. Phase 4：Account/Auth/Server/Relay/Gateway 契约。
3. Phase 5：`apps/server` + auth runtime。
4. Phase 6：管理后台。
5. Phase 8：安全、隔离、审计测试。
6. Phase 9：Flutter app。
7. Phase 10：multi-workspace。

一句话原则：

**先让 Mac 上的 agent session 变成一个可靠、可授权、可审计、可远程接管的资源，再扩客户端。**
