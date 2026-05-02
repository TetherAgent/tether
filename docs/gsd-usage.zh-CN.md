# GSD 使用指南

GSD（Get Shit Done）是一套帮你把"想法 → 落地"过程结构化的命令集，专为 Claude Code 优化。

## 三步上手

```
/gsd-new-project      # 1. 初始化项目（提问 → 研究 → 需求 → 路线图）
/gsd-plan-phase 1     # 2. 给第一个阶段做详细计划
/gsd-execute-phase 1  # 3. 执行该阶段
```

## 核心工作流

```
新项目 → 规划阶段 → 执行阶段 → 重复
```

每个阶段（phase）都会产生 `PLAN.md` 和 `SUMMARY.md`，记录在 `.planning/phases/` 里。

## 按场景选命令

### 新项目起步

- `/gsd-new-project` — 全新项目从零开始
- `/gsd-map-codebase` — 已有代码库，先让 GSD 摸清结构再启动

### 阶段规划（在 execute 前）

- `/gsd-discuss-phase N` — 先聊清楚你心里这个阶段长啥样
- `/gsd-research-phase N` — 复杂领域（3D/音频/ML）做生态调研
- `/gsd-plan-phase N` — 生成详细任务计划
- `/gsd-list-phase-assumptions N` — 看 Claude 打算怎么做，及时纠偏

### 执行

- `/gsd-execute-phase N` — 跑完整个阶段
- `/gsd-execute-phase N --wave 2` — 只跑某一波

### 前端 / UI 设计（产品型需求专用）

针对"页面写得丑、没有设计感、不符合产品体验"的痛点，GSD 提供一条
"先补 UI 合约 → 再执行 → 再视觉审计"的链路：

- `/gsd-ui-phase N` — 在执行前生成阶段的 UI 设计合约 `UI-SPEC.md`
  （信息架构、组件契约、交互状态、可访问性约束）
- `/gsd-ui-review N` — 阶段完成后做 6 维视觉审计（布局 / 排版 / 色彩
  / 间距 / 状态 / 一致性），产出 `UI-REVIEW.md`
- `/gsd-sketch "管理后台布局"` — 在合约之前先用一次性 HTML 草图探设计方向
- `/web-design-guidelines` — 按 Web Interface Guidelines 复核 UI 代码

典型搭配：`/gsd-ui-phase N` → `/gsd-execute-phase N` → `/gsd-ui-review N`。
比纯写代码更适合前端页面开发。

### 轻量任务（不想走完整流程）

- `/gsd-fast "改个 typo"` — 极小任务，直接改 + 提交
- `/gsd-quick` — 小任务但需要计划 + 执行
- `/gsd-quick --full` — 小任务但要完整质量流水线

### 进度与恢复

- `/gsd-progress` — 看现在到哪了，下一步该干啥
- `/gsd-resume-work` — 中断后恢复上下文
- `/gsd-pause-work` — 主动暂停，留交接信息

### 路线图调整

- `/gsd-add-phase "描述"` — 末尾追加阶段
- `/gsd-insert-phase 7 "描述"` — 在 7 和 8 之间插入 7.1
- `/gsd-remove-phase N` — 删除未开始的阶段

### 里程碑

- `/gsd-new-milestone "v2.0"` — 开新里程碑
- `/gsd-complete-milestone 1.0.0` — 归档已完成里程碑
- `/gsd-audit-milestone` — 检查里程碑完成度

### 调试

- `/gsd-debug "登录按钮不工作"` — 系统化调试，跨上下文存档
- `/gsd-debug` — 不带参数 = 恢复上次会话

### 实验 / 草图

- `/gsd-spike "能用 WebSocket 流式输出吗？"` — 快速可行性验证
- `/gsd-sketch "管理后台布局"` — HTML 多版本设计草图

### 收尾

- `/gsd-verify-work N` — 对照 SUMMARY 做 UAT 验收
- `/gsd-ship N` — 推分支建 PR
- `/gsd-pr-branch` — 生成不含 `.planning/` 的干净 PR 分支

### 不知道用哪个命令

- `/gsd-do "我想干啥"` — 自然语言路由到对应命令

## 常见组合

### 新项目典型流程

```
/gsd-new-project
/clear
/gsd-plan-phase 1
/clear
/gsd-execute-phase 1
```

### 中途冒出紧急工作

```
/gsd-insert-phase 5 "修紧急安全漏洞"
/gsd-plan-phase 5.1
/gsd-execute-phase 5.1
```

### 休息回来

```
/gsd-progress
```

## 文件结构

```
.planning/
├── PROJECT.md      # 项目愿景
├── ROADMAP.md      # 阶段拆分
├── STATE.md        # 项目记忆
├── phases/         # 各阶段的 PLAN/SUMMARY
├── todos/          # 临时记下的想法
└── debug/          # 调试会话
```

## 工作模式

`.planning/config.json` 里可切：

- **interactive** — 每个关键决策都确认
- **yolo** — 自动通过，只在关键点停

## 更多

- 完整命令列表：`/gsd-help`
- 升级 GSD：`/gsd-update` 或 `npx get-shit-done-cc@latest`
