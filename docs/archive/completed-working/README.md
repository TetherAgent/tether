# 已完成 Working 文档归档

状态：Completed Archive  
更新时间：2026-05-11

这些文档原位于 `docs/working/`。它们对应的讨论、迁移或修复主线已完成，不再作为当前工作草稿入口。

| 文档路径 | 原用途 | 当前处理 |
| --- | --- | --- |
| [2026-05-01-tether-agent-console.md](2026-05-01-tether-agent-console.md) | 项目主设计草稿 | 长期事实已沉淀到 `AI_CONTEXT.md` 和 `docs/current/` 相关文档 |
| [2026-05-01-phase-2-pty-event-stream.md](2026-05-01-phase-2-pty-event-stream.md) | Phase 2 PTY event stream 草案 | PTY-only 方向已成为当前架构事实 |
| [2026-05-02-tether-capability-map.md](2026-05-02-tether-capability-map.md) | 长期能力地图 | 作为历史能力拆解参考保留 |
| [2026-05-03-frontend-design-migration-checklist.md](2026-05-03-frontend-design-migration-checklist.md) | 前端设计系统迁移清单 | 迁移主线已完成，后续规范以 `FRONTEND.md` 和 app 级规则为准 |
| [2026-05-03-gateway-profile-init.md](2026-05-03-gateway-profile-init.md) | Gateway profile / init 启动模型方案 | 启动与部署口径以 `docs/current/deploy-and-start.md` 为准 |
| [2026-05-03-server-cli-bug-todo.md](2026-05-03-server-cli-bug-todo.md) | Server / CLI / Gateway / Relay bug TODO | 已完成项归档，剩余 token/auth 问题已拆到 `docs/working/2026-05-04-token-auth-unfinished-items.md` |
| [2026-05-04-relay-control-frame-scope.md](2026-05-04-relay-control-frame-scope.md) | Relay 控制帧 session scope 强校验方案 | 已实现并通过 relay/gateway 测试覆盖 |
| [2026-05-04-gateway-session-recovery.md](2026-05-04-gateway-session-recovery.md) | Gateway 重启后的 session 恢复缺口分析与收口记录 | runner-backed session 恢复主路径已落地，文档转为历史验收与背景记录 |
| [2026-05-04-half-bridge-real-claude.html](2026-05-04-half-bridge-real-claude.html) | PTY 半桥渲染的真实数据调试稿 | 作为历史渲染实验样例保留，不再作为当前实现入口 |
| [2026-05-04-simple-chat-mockup-stream-json.html](2026-05-04-simple-chat-mockup-stream-json.html) | stream-json 聊天视图原型 | 作为历史 UI 探索样例保留，不再作为当前工作草稿 |
| [2026-05-04-simple-chat-mockup-synthetic-terminal.html](2026-05-04-simple-chat-mockup-synthetic-terminal.html) | SyntheticTerminalRenderer 聊天视图原型 | 作为历史 UI 探索样例保留，不再作为当前工作草稿 |
| [2026-05-04-simple-chat-mockup-xterm-parsed.html](2026-05-04-simple-chat-mockup-xterm-parsed.html) | xterm-parsed 聊天视图原型 | 作为历史 UI 探索样例保留，不再作为当前工作草稿 |
| [2026-05-04-stream-json-playback.html](2026-05-04-stream-json-playback.html) | stream-json 回放实验页 | 作为历史回放实验样例保留，不再作为当前工作草稿 |
| [2026-05-04-terminal-renderer-comparison.html](2026-05-04-terminal-renderer-comparison.html) | PTY 渲染方案 A/B/C 对比实验页 | 作为历史渲染方案对比记录保留，不再作为当前工作草稿 |
| [pty-samples/](pty-samples/) | PTY 样本数据 | 作为历史渲染 / 回放调试样本保留 |
| [2026-05-04-direct-relay-replay-consistency.md](2026-05-04-direct-relay-replay-consistency.md) | Direct / Relay 回放一致性和分页根因记录 | 相关链路已进入后续阶段实现与验收，归档为历史问题背景 |
| [2026-05-04-npm-cli-gateway-packaging.md](2026-05-04-npm-cli-gateway-packaging.md) | npm CLI 与 Gateway 打包发布方案 | 作为发布 / 打包历史方案保留，不再作为当前 working 入口 |
| [2026-05-04-simple-chat-view-clean-text.md](2026-05-04-simple-chat-view-clean-text.md) | 简洁聊天视图 clean text 方案 | 聊天视图后续已演进到 Phase 11+，归档为历史 UI/解析背景 |
| [2026-05-04-token-auth-unfinished-items.md](2026-05-04-token-auth-unfinished-items.md) | token/auth 未完成项清单 | 后续认证、Relay 和 Server 阶段已吸收主要事项 |
| [2026-05-04-unified-web-session-create.md](2026-05-04-unified-web-session-create.md) | Direct / Relay 统一 Web 创建后台 session 方案 | 相关创建链路已进入阶段实现与后续计划，归档为历史方案 |
| [2026-05-05-agent-jsonl-history-view.md](2026-05-05-agent-jsonl-history-view.md) | agent JSONL 历史视图方案 | 聊天 / 历史链路已由后续阶段接管，归档为历史探索 |
| [2026-05-06-chat-surface-mockup.html](2026-05-06-chat-surface-mockup.html) | chat surface HTML 原型 | 作为历史 UI 原型保留 |
| [2026-05-06-chat-surface-ux-design.md](2026-05-06-chat-surface-ux-design.md) | chat surface UX 设计 | Phase 11+ 聊天界面已吸收主要方向，归档为历史设计稿 |
| [2026-05-08-chat-web-issues.md](2026-05-08-chat-web-issues.md) | Chat Web 问题清单 | 相关问题已被后续 Phase / quick fix 吸收，归档为历史排查记录 |
| [2026-05-09-server-db-runtime-sync.md](2026-05-09-server-db-runtime-sync.md) | Server DB runtime sync 方案 | Phase 12 已完成并产出 GSD 验证记录 |
| [2026-05-11-chat-remote-session-metadata.md](2026-05-11-chat-remote-session-metadata.md) | Chat 去本地 DB / Relay 补 metadata 方案 | Phase 15 已完成自动实现，人工 UAT 记录在 `.planning/phases/15-chat-remote-session-metadata/15-HUMAN-UAT.md` |
| [2026-05-11-chat-session-title-ownership.md](2026-05-11-chat-session-title-ownership.md) | Chat title ownership / `title_source` 方案 | 已通过 quick fix 落地并有对应 summary |
| [2026-05-11-pty-remote-event-store.md](2026-05-11-pty-remote-event-store.md) | PTY 远端事件存储边界方案 | 已明确为后续阶段边界，归档为历史拆分依据 |
