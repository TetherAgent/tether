# 文档治理

这是 Tether 的文档总入口。

**核心治理原则**：

1. 用 `docs` 管当前知识，用 `.planning` 管 GSD 计划、执行和验收状态。
2. 一个模块在任一时刻最多只允许有一份"当前有效说明"。
3. 团队/AI 默认使用中文。

## 目录定位

| 目录 | 用途 | 包含什么 |
| --- | --- | --- |
| **[current/](current/)** | 当前事实来源 | 已确认、现行有效的设计与规格。这是主干。 |
| **[working/](working/)** | 工作草稿 | 还在讨论中、未正式立项的过程方案。文件名 `YYYY-MM-DD-<slug>.md`。 |
| **[../.planning/](../.planning/)** | GSD 工作区 | 阶段计划、执行状态、验收记录和项目进度。 |

## 当前知识库导览 (`current/`)

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [deploy-and-start.md](current/deploy-and-start.md) | **Current** | Tether 部署和启动：云服务器 Relay/Web、本机 Gateway、nginx、Phase 5 本地 Web/Server/Gateway 启动与登录验收 |
| [gateway-supervisor.md](current/gateway-supervisor.md) | **Current** | Phase 6 Gateway supervisor：常驻 Gateway、launchd 后台运行、CLI 转发和 inline fallback |
| [relay-mvp.md](current/relay-mvp.md) | **Current** | Phase 1 Personal Relay MVP：nginx serve `apps/web`，`apps/relay` 作为 Node relay 服务 |

## 当前工作草稿 (`working/`)

> 命名约定：`YYYY-MM-DD-<topic-slug>.md`

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [2026-05-01-tether-agent-console.md](working/2026-05-01-tether-agent-console.md) | **Working** | 项目主设计：定位、阶段路线（Phase 1–4）、技术栈与决策记录 |
| [2026-05-01-phase-2-pty-event-stream.md](working/2026-05-01-phase-2-pty-event-stream.md) | **Working** | Phase 2 设计草案：用 PTY-backed event stream 替换 tmux，并定义任务与验收 |

## 工作流指南

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [gsd-workflow-guide.md](gsd-workflow-guide.md) | **Guide** | 在 Tether 仓库内使用 GSD 做需求拆解、计划、执行和验收 |
| [gsd-usage.zh-CN.md](gsd-usage.zh-CN.md) | **Guide** | GSD 命令速查和常见组合 |

## 工作流（Ideas → Code）

1. **想法 / 问题阶段**：在 `docs/working/` 写草稿。
2. **确认要立项开发**：用 GSD 生成或更新 `.planning/` 中的阶段计划。
3. **开始写代码**：开发期间以对应阶段的 `PLAN.md`、验收项和用户最新确认作为执行依据。
4. **开发完成**：更新 GSD 状态，并把长期有效事实沉淀到 `docs/current/`。
5. **知识沉淀**：通用规则和架构约定回写到根目录长期文档，常驻说明回写到
   `docs/current/`。

理解为：**`docs/working/`（起草） → `.planning/`（计划/施工/验收） →
`docs/current/` 与根目录长期文档（地图更新）**。
