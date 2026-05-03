# 前端设计系统迁移任务清单

更新时间：2026-05-03

## 目标

把 `apps/web` 和 `apps/admin-web` 的基础 UI 收口到共享设计系统，迁入并落地：

- `packages/design`
- `packages/theme`
- 仓库级 `FRONTEND.md`

同时停止两个 app 继续维护本地基础组件副本。

## 已确认范围

- 迁入 `earntools` 的 `packages/design` 和 `packages/theme`，改造成 `tether` 自己的共享包
- 把 `earntools/FRONTEND.md` 改写为 `tether/FRONTEND.md`
- `apps/web`、`apps/admin-web` 基础组件统一改用共享 `packages/design`
- app 层只保留业务布局、业务组件、表单适配层
- 收掉明显的页面级手写基础视觉，尤其是 `apps/admin-web` 里的大块内联样式

## 任务清单

- [x] 盘点当前仓库前端现状，并确认迁移方案边界
- [x] 新建 `tether/FRONTEND.md`，写入当前仓库适用的前端规范
- [x] 迁入 `packages/theme`，完成包名、依赖和路径改造
- [x] 迁入 `packages/design`，完成包名、依赖和路径改造
- [x] 调整共享 theme 的 Tailwind v4 source 扫描和 app 样式入口
- [x] 让 `apps/web` 改用共享 theme
- [x] 让 `apps/admin-web` 改用共享 theme
- [x] 替换 `apps/web` 本地基础组件 import，切到共享 `packages/design`
- [x] 替换 `apps/admin-web` 本地基础组件 import，切到共享 `packages/design`
- [x] 保留并整理 app 层表单适配组件，不把业务表单封装硬塞进共享 design
- [x] 重构 `apps/admin-web` 的 `AdminLayout` 和明显的页面级内联样式
- [x] 删除两个 app 中已被共享包接管的本地基础组件副本
- [x] 补齐迁移后的文档说明和使用入口
- [x] 跑 `pnpm typecheck`
- [x] 跑 `apps/web` 构建验证
- [x] 跑 `apps/admin-web` 构建验证

## 当前状态说明

当前迁移主线已完成：共享 `theme/design` 已接管两个 app 的基础组件和样式入口。

未完成浏览器内视觉验收；目前只完成了 `typecheck` 和两个 app 的 production build 验证。
