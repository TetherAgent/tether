# 文档治理

这是 Tether 的文档总入口。

**核心治理原则**：

1. 用 `docs` 管当前知识，用 `openspec` 管变更流程。
2. 一个模块在任一时刻最多只允许有一份"当前有效说明"。
3. 团队/AI 默认使用中文。

## 目录定位

| 目录 | 用途 | 包含什么 |
| --- | --- | --- |
| **[current/](current/)** | 当前事实来源 | 已确认、现行有效的设计与规格。这是主干。 |
| **[working/](working/)** | 工作草稿 | 还在讨论中、未正式立项的过程方案。文件名 `YYYY-MM-DD-<slug>.md`。 |
| **[../openspec/specs/](../openspec/specs/)** | 长期能力契约 | 跨阶段稳定的 contract。 |
| **[../openspec/changes/](../openspec/changes/)** | 活跃变更 | 已立项、施工中的 OpenSpec 任务包。 |

## 当前知识库导览 (`current/`)

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [relay-mvp.md](current/relay-mvp.md) | **Current** | Phase 1 Personal Relay MVP：nginx serve `apps/web`，`apps/relay` 作为 Node relay 服务 |

## 当前工作草稿 (`working/`)

> 命名约定：`YYYY-MM-DD-<topic-slug>.md`

| 文档路径 | 状态 | 内容描述 |
| --- | --- | --- |
| [2026-05-01-tether-agent-console.md](working/2026-05-01-tether-agent-console.md) | **Working** | 项目主设计：定位、阶段路线（Phase 1–4）、技术栈与决策记录 |
| [2026-05-01-phase-2-pty-event-stream.md](working/2026-05-01-phase-2-pty-event-stream.md) | **Working** | Phase 2 设计草案：用 PTY-backed event stream 替换 tmux，并定义任务与验收 |

## 工作流（Ideas → Code）

1. **想法 / 问题阶段**：在 `docs/working/` 写草稿。
2. **确认要立项开发**：启动 OpenSpec 流程（`openspec/changes/<name>/` 下生成
   proposal、design、tasks）。
3. **开始写代码**：开发期间只认 OpenSpec 里的 tasks，不认其他地方的描述。
4. **开发完成**：归档该 OpenSpec change 至 `openspec/changes/archive/`。
5. **知识沉淀**：长期有效规则回写到根目录长期文档 / `openspec/specs/`，常驻
   说明回写到 `docs/current/`。

理解为：**`docs/working/`（起草） → `openspec/changes/`（施工） → 归档 →
`docs/current/` 与根目录长期文档（地图更新）**。
