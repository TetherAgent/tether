# Phase 13: Mobile Web Chat Interface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-10
**Phase:** 13-mobile-web-chat
**Areas discussed:** 会话创建路径, Model 来源, Session ID 追踪, UI 入口, Relay→Server 同步时机, 代码位置, 导航结构, 列表内容, 认证体系

---

## 会话创建路径

| Option | Description | Selected |
|--------|-------------|----------|
| Relay WS 新帧 | 在现有 WS 通道加 client.create-session 帧 | ✓ |
| Server REST API | 网页调 Server HTTP，Server 再通知 Gateway | |
| Relay HTTP 端点 | Relay 新增 POST /sessions HTTP 接口 | |

**User's choice:** Relay WS 新帧
**Notes:** 复用现有 WS 通道，不增加 HTTP 接口复杂度

---

## Model 来源

| Option | Description | Selected |
|--------|-------------|----------|
| Gateway 硬编码白名单 | 前端写死固定列表 | |
| Gateway 动态查询 | 新增 client.list-providers 帧，动态获取 | ✓ |

**User's choice:** Gateway 动态查询
**Notes:** 更准确反映当前 gateway 实际可用 provider

---

## Session ID 追踪

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | 本地存储，简单 | |
| Server DB 关联用户 | Session 关联到账号，跨设备同步 | ✓ |
| 两者都要 | localStorage 快速访问 + Server 跨设备 | |

**User's choice:** Server DB 关联用户

---

## UI 入口 / 代码位置

| Option | Description | Selected |
|--------|-------------|----------|
| 替换现有 apps/web | 重写 apps/web | |
| 新建 apps/mobile-web | 独立新 app，不改动 web | ✓ |
| 现有 apps/web 加路由 | 两套并存 | |

**User's choice:** 新建 apps/mobile-web
**Notes:** 用户明确说"全新做，现在的前端代码可以删除，和微信聊天界面类似"，并附上微信截图作为布局参考

---

## UI 结构

**User's choice:** 类微信布局——左侧窄导航图标栏 + 中间会话列表 + 右侧聊天区

导航 tab（用户选择）：
- ✓ 会话列表
- ✓ 新建会话入口（+ 按钮）
- ✓ 设置/账号

会话列表每行（用户选择）：
- ✓ AI 头像 + model 名称
- ✓ 最后一条消息预览
- ✓ 时间戳
- ✓ 未读/进行中标记

---

## Relay → Server 同步时机

| Option | Description | Selected |
|--------|-------------|----------|
| 创建+chat 事件 | 仅关键事件 | |
| 仅 chat 事件 | 只同步对话 | |
| 全量事件 | 所有经过 Relay 的事件 | ✓ |

**User's choice:** 全量事件

---

## 认证体系

**User's message:** "要把现在web的登录整个体系还有 auth 搬过去，登录接口要复用"

**Decision:** apps/web 的登录 UI、auth context、路由守卫全部搬迁到 apps/mobile-web；Server 侧登录接口直接复用，不修改。

---

## Claude's Discretion

- Model 头像颜色方案（Claude=紫、Codex=蓝、opencode=橙）由 Claude 参考 mockup 决定
- 具体 CSS 变量和组件拆分方式

## Deferred Ideas

- PWA push 通知 — 独立 phase
- Flutter 客户端 — Phase 9
- 多 workspace 切换 — Phase 10
- 权限审批按钮实际执行逻辑 — Phase 2 Experience Hardening
