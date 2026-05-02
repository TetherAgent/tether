# GSD 使用指南

本文说明在 Tether 仓库中如何使用 GSD 做需求拆解、计划、执行和验收。

GSD 的作用不是替代代码实现，而是把“想法”变成可追踪的项目上下文、阶段路线图、执行计划和验收记录。日常新需求可以按本文流程推进。

## 一句话流程

```text
代码地图 → 项目初始化 → 阶段计划 → 执行阶段 → 验收验证 → 修复缺口
```

最常用命令：

```text
$gsd-map-codebase
$gsd-new-project
$gsd-plan-phase
$gsd-execute-phase
$gsd-verify-work
```

## 什么时候用 GSD

适合使用 GSD：

1. 新功能从想法进入可开发状态。
2. 一个需求需要拆成多个阶段。
3. 需要让 AI 先理解现有代码，再规划改动。
4. 需求跨 `apps/gateway`、`apps/cli`、`apps/web`、`packages/protocol` 或测试。
5. 涉及 Gateway、Relay、PTY event stream、认证、pairing、Web 客户端等关键链路。
6. 上次做了一半，需要恢复上下文继续推进。
7. 做完功能后，需要按用户视角验收。

不一定需要 GSD：

1. 一行 typo。
2. 很小的纯文档改动。
3. 临时查一个文件、解释一段代码。
4. 明确知道要改哪一行的小修复。

## 第一步：确认代码地图

命令：

```text
$gsd-map-codebase
```

作用：

1. 分析当前代码库。
2. 生成 `.planning/codebase/` 下的代码地图。
3. 让后续规划阶段能引用真实结构，而不是凭印象猜。

输出文档：

```text
.planning/codebase/STACK.md
.planning/codebase/INTEGRATIONS.md
.planning/codebase/ARCHITECTURE.md
.planning/codebase/STRUCTURE.md
.planning/codebase/CONVENTIONS.md
.planning/codebase/TESTING.md
.planning/codebase/CONCERNS.md
```

当前 Tether 已经生成过代码地图。短期内不用反复跑。以下情况再刷新：

1. 目录结构大改。
2. 新增重要应用、服务或共享包。
3. 技术栈变化。
4. 旧地图明显过期。

轻量刷新示例：

```text
$gsd-map-codebase --fast
$gsd-map-codebase --fast --focus tech
$gsd-map-codebase --fast --focus arch
```

## 第二步：初始化项目

命令：

```text
$gsd-new-project
```

作用：

1. 收集项目目标、范围、约束和偏好。
2. 生成 `.planning/PROJECT.md`。
3. 生成 `.planning/REQUIREMENTS.md`。
4. 生成 `.planning/ROADMAP.md`。
5. 生成 `.planning/STATE.md`。

适合场景：

1. 一个较大的新方向。
2. 一个需要多个阶段完成的模块。
3. 还没有清晰路线图的产品想法。

示例：

```text
$gsd-new-project 做一个 owner device authentication，包括 pair、devices、revoke 和 WebSocket 写权限校验
```

如果已经有比较完整的想法文档，可以让 GSD 基于该文档初始化。

```text
$gsd-new-project --auto @docs/working/xxx.md
```

## 第三步：规划阶段

命令：

```text
$gsd-plan-phase
```

作用：

1. 从 `.planning/ROADMAP.md` 中选择阶段。
2. 补充阶段上下文。
3. 生成可执行的 `PLAN.md`。
4. 自动检查计划是否能达成阶段目标。

常用方式：

```text
$gsd-plan-phase 1
$gsd-plan-phase 2
$gsd-plan-phase
```

不传数字时，GSD 会尝试选择下一个未规划阶段。

常用参数：

```text
$gsd-plan-phase 1 --mvp
$gsd-plan-phase 2 --skip-research
$gsd-plan-phase 3 --research
$gsd-plan-phase 4 --prd docs/working/xxx.md
```

参数含义：

1. `--mvp`：按垂直切片规划，适合第一阶段先做可跑通的最小闭环。
2. `--skip-research`：跳过研究，直接规划。
3. `--research`：强制重新研究。
4. `--prd <file>`：基于已有 PRD 或验收标准规划。
5. `--gaps`：只规划验收后发现的缺口修复。

## 第四步：执行阶段

命令：

```text
$gsd-execute-phase
```

作用：

1. 读取某个阶段下的执行计划。
2. 分析任务依赖。
3. 按 wave 分批执行。
4. 必要时并行派发子任务。
5. 执行后更新阶段状态。

常用方式：

```text
$gsd-execute-phase 1
$gsd-execute-phase 2
```

只执行某一波：

```text
$gsd-execute-phase 1 --wave 1
$gsd-execute-phase 1 --wave 2
```

小修复或想边做边看时：

```text
$gsd-execute-phase 1 --interactive
```

只执行验收缺口修复：

```text
$gsd-execute-phase 1 --gaps-only
```

## 第五步：验收功能

命令：

```text
$gsd-verify-work
```

作用：

1. 按用户视角检查功能是否真的可用。
2. 记录 UAT 结果。
3. 如果发现问题，生成缺口诊断和修复计划。

常用方式：

```text
$gsd-verify-work 1
$gsd-verify-work
```

如果验收发现问题，后续通常接：

```text
$gsd-plan-phase 1 --gaps
$gsd-execute-phase 1 --gaps-only
```

## Tether 项目内的特别规则

GSD 生成计划和执行代码时，必须遵守本仓库规则：

1. 开始前先读 `AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`AI_CONTEXT.md` 和 `docs/README.md`。
2. 包管理器使用 `pnpm`。
3. 子进程调用必须使用 `spawn(cmd, args[])`，绝不使用 `shell:true` 拼字符串。
4. Gateway 默认只监听 `127.0.0.1`，不要把未完成认证的服务暴露到公网。
5. 终端输出外发到客户端前要做基础敏感信息掩码。
6. 客户端只能控制既有 agent session，不能让 Gateway 执行任意命令。
7. 涉及长期事实时，同步回写 `docs/current/`、根目录长期文档或 `openspec/specs/`。

## 与 OpenSpec 的关系

Tether 的文档治理顺序是：

```text
docs/working/ → openspec/changes/<name>/ → openspec/specs/<capability>/ → 根目录长期文档
```

建议这样配合：

1. 还在想方向：先写 `docs/working/YYYY-MM-DD-<topic>.md`，必要时用 GSD 帮忙梳理。
2. 确认要开发：用 OpenSpec change 承载 proposal、design、tasks。
3. 进入执行：GSD 的 `PLAN.md` 应对齐 OpenSpec 的 `tasks.md`，不能两套任务各说各话。
4. 做完归档：OpenSpec 归档后，把长期有效事实沉淀到 `docs/current/`、`AI_CONTEXT.md` 或 `PROJECT.md`。

## 日常新需求推荐流程

### 小需求

适合：范围清楚、只影响少量文件、没有复杂产品探索。

```text
$gsd-plan-phase 做一个 xxx 功能
$gsd-execute-phase
$gsd-verify-work
```

也可以直接说：

```text
帮我按 GSD 规划并实现 xxx
```

### 中等需求

适合：需要前后端协作、涉及测试、需要明确验收标准。

```text
$gsd-map-codebase --fast
$gsd-plan-phase 做一个 xxx 功能
$gsd-execute-phase
$gsd-verify-work
```

### 大需求

适合：一个新模块、一个新产品方向、需要多个阶段。

```text
$gsd-map-codebase
$gsd-new-project
$gsd-plan-phase 1 --mvp
$gsd-execute-phase 1
$gsd-verify-work 1
```

后续阶段：

```text
$gsd-plan-phase 2
$gsd-execute-phase 2
$gsd-verify-work 2
```

## 常用说法

你可以直接这样发给 AI：

```text
$gsd-map-codebase
```

```text
$gsd-new-project 做一个 xxx 模块
```

```text
$gsd-plan-phase 1 --mvp
```

```text
$gsd-execute-phase 1
```

```text
$gsd-verify-work 1
```

```text
按 GSD 给我规划这个需求：xxx
```

```text
继续执行当前 GSD 阶段
```

```text
只修 GSD 验收里发现的问题
```

## 生成物位置

GSD 主要写入 `.planning/`：

```text
.planning/PROJECT.md
.planning/REQUIREMENTS.md
.planning/ROADMAP.md
.planning/STATE.md
.planning/codebase/
.planning/research/
.planning/phases/
```

阶段执行过程中还会生成阶段目录、计划、总结、验证记录和 UAT 记录。具体位置由 GSD 当前配置和 roadmap 决定。

当前 Tether 已存在的阶段目录包括：

```text
.planning/phases/01-personal-relay-mvp/
.planning/phases/06-supervisor-launchd/
```

## Tether 当前状态

截至本指南写入时：

1. `.planning/codebase/` 已存在。
2. `.planning/PROJECT.md`、`.planning/REQUIREMENTS.md`、`.planning/ROADMAP.md`、`.planning/STATE.md` 已存在。
3. 已有阶段记录包括 Personal Relay MVP 和 Gateway supervisor / launchd。
4. 后续新需求可以优先从 `$gsd-plan-phase` 或 `$gsd-new-project` 开始。

## 推荐默认策略

如果你不确定该用哪个命令：

1. 已经有清楚需求，但没有计划：用 `$gsd-plan-phase`。
2. 需求很大，像一个新项目：用 `$gsd-new-project`。
3. 代码结构刚大改：先用 `$gsd-map-codebase`。
4. 已经有计划，要开始写代码：用 `$gsd-execute-phase`。
5. 已经写完，要确认能不能用：用 `$gsd-verify-work`。

## 验证命令参考

执行阶段完成后，至少根据影响范围选择验证：

```text
pnpm typecheck
pnpm test
pnpm tether --help
pnpm tether gateway status
```

涉及 Gateway、PTY、Relay 或 WebSocket 的改动，不能只看类型检查。需要实际启动相关服务，验证 session 创建、attach、输入发送、事件流输出和权限边界。
