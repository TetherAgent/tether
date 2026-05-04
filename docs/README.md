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
| **[archive/](archive/)** | 归档记录 | 已完成、已被当前文档吸收或不再作为当前事实入口的历史工作文档。 |
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
| [2026-05-04-gateway-session-recovery.md](working/2026-05-04-gateway-session-recovery.md) | **Working** | Gateway 重启后 running session 恢复、失联标记、stream 明确错误和可重附着 supervisor 缺口 |
| [2026-05-04-npm-cli-gateway-packaging.md](working/2026-05-04-npm-cli-gateway-packaging.md) | **Working** | npm CLI 与本机 Gateway 打包发布给其他用户安装使用的方案 |
| [2026-05-04-token-auth-unfinished-items.md](working/2026-05-04-token-auth-unfinished-items.md) | **Working** | 当前代码核验后仍未完成的 token/auth 问题清单 |

## 归档记录 (`archive/`)

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [completed-working/](archive/completed-working/) | **Completed Archive** | 已完成并从 `working/` 移出的阶段草稿、迁移清单和 bug TODO 记录 |

## 工作流指南

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [gsd/gsd-workflow-guide.md](gsd/gsd-workflow-guide.md) | **Guide** | 在 Tether 仓库内使用 GSD 做需求拆解、计划、执行和验收 |
| [gsd/gsd-usage.zh-CN.md](gsd/gsd-usage.zh-CN.md) | **Guide** | GSD 命令速查和常见组合 |

## 工作流（Ideas → Code）

1. **想法 / 问题阶段**：在 `docs/working/` 写草稿。
2. **确认要立项开发**：用 GSD 生成或更新 `.planning/` 中的阶段计划。
3. **开始写代码**：开发期间以对应阶段的 `PLAN.md`、验收项和用户最新确认作为执行依据。
4. **开发完成**：更新 GSD 状态，并把长期有效事实沉淀到 `docs/current/`。
5. **知识沉淀**：通用规则和架构约定回写到根目录长期文档，常驻说明回写到
   `docs/current/`。

理解为：**`docs/working/`（起草） → `.planning/`（计划/施工/验收） →
`docs/current/` 与根目录长期文档（地图更新） → `docs/archive/`（完成后归档）**。
