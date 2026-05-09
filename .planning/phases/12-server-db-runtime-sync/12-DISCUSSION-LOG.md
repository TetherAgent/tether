# Phase 12: Server DB Runtime Sync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-09
**Phase:** 12-server-db-runtime-sync
**Areas discussed:** Phase 11 conversation_turns 去留, Relay 写 Server 失败降级策略, terminal.output 保留上限, 读接口分流实现位置

---

## Phase 11 conversation_turns 去留

| Option | Description | Selected |
|--------|-------------|----------|
| 废弃 conversation_turns | Phase 12 完成后停止新写，删除表定义，移除 JournalWatcher 写入逻辑 | ✓ |
| 保留为本地备份 | JournalWatcher 继续写 SQLite，Relay 另外同步 Server DB | |
| 过渡期共存，完成后再决定 | 等 Server DB 稳定后再停写 | |

**User's choice:** 废弃 conversation_turns（Phase 12 内清理）

| Option | Description | Selected |
|--------|-------------|----------|
| JournalWatcher 不动，利用现有 agent.turn 事件 | Relay 收到 agent.turn 时同步 Server DB；JournalWatcher 路径不改 | ✓ |
| Phase 12 中直接移除 JournalWatcher 写 SQLite | 一步到位，但调整面更大 | |

**User's choice:** JournalWatcher 指向不变，利用现有 agent.turn 事件路径

| Option | Description | Selected |
|--------|-------------|----------|
| Server DB 搞定后一步切 | 流程调通后直接切换，不保留双读 | ✓ |
| Server DB miss 时 fallback 读 Gateway | 过渡更平滑，但逻辑更复杂 | |

**User's choice:** 一步切，不做双读 fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 12 内删除表 + 移除 JournalWatcher 写入逻辑 | 同一个 PR 内清理干净 | ✓ |
| 只移除写入，表留着备用 | 后续再删 | |

**User's choice:** Phase 12 内彻底清理

---

## Relay 写 Server 失败降级策略

| Option | Description | Selected |
|--------|-------------|----------|
| 静默跳过 + 靠 Gateway 重连补偿 | 失败只记日志，不阻塞实时转发；靠 gateway_sync_cursors 补洞 | ✓ |
| Relay 本地内存队列 + 延迟重试 | 自愈力更强，但 Relay 重启后队列丢失 | |
| 失败不影响实时转发（同上述第一项明确版） | | |

**User's choice:** 静默跳过 + Gateway 重连补偿

| Option | Description | Selected |
|--------|-------------|----------|
| 并行，互不阻塞 | 同时 Promise：转发给 Client + 同步 Server | ✓ |
| 先转发客户端，后异步同步 Server | 优先实时性，略有逻辑差异 | |

**User's choice:** 并行执行

| Option | Description | Selected |
|--------|-------------|----------|
| Header secret（TETHER_RUNTIME_SYNC_SECRET） | 静态环境变量，nginx 额外限 127.0.0.1 | ✓ |
| 共享内部 JWT | 更灵活但对精简内部接口过度设计 | |

**User's choice:** Header secret

---

## terminal.output 保留上限

| Option | Description | Selected |
|--------|-------------|----------|
| 按条数 1000 条 | 简单，适合近期历史语义 | |
| 按 bytes 1MB | 与 Phase 7 逻辑一致 | |
| 按时间 24h | 合理但需定期清理 job | |
| 极简：不写 terminal.output | 只写结构化事件 | |
| 10 万条/session + 超 1 个月清理（用户自定义） | 每天 Egg schedule 任务 | ✓ |

**User's choice:** 每 session 最新 10 万条，同时清理超过 1 个月的旧行，Egg.js app/schedule/ 每天执行

| Option | Description | Selected |
|--------|-------------|----------|
| Server 进程内 setInterval | 不依赖外部 cron | |
| Egg 的定时任务 | 框架约定式，app/schedule/ | ✓ |
| 系统 cron | 需运维配置 | |

**User's choice:** Egg 定时任务（app/schedule/）

| Option | Description | Selected |
|--------|-------------|----------|
| 不写 terminal.input | 敏感且回放意义小 | |
| 写 terminal.input，必须经过 mask | 保留输入历史，安全前提下 | ✓ |

**User's choice:** 写 terminal.input，经过 maskSensitiveOutput

---

## 读接口分流实现位置

| Option | Description | Selected |
|--------|-------------|----------|
| nginx 显式按路径拆分 | 读接口 → Server，控制接口 → Relay，最清晰 | ✓ |
| Server 内部代理控制接口到 Relay | 客户端只打 Server，Server 转发 | |
| Relay 代理读接口到 Server | 少改 nginx | |

**User's choice:** nginx 显式拆分

| Option | Description | Selected |
|--------|-------------|----------|
| 保留 Relay RPC 读路径作 fallback | DB miss 时回落 Gateway | |
| 不保留，切换后只读 Server DB | Server DB miss 返回空 | ✓ |

**User's choice:** 切换后不保留 Relay RPC 读路径

| Option | Description | Selected |
|--------|-------------|----------|
| App 切到读 Server HTTP 接口 | 与 Web 使用同一读路径 | ✓ |
| App 保持 WS 拉取，后续优化 | 不动 App，Phase 12 只改后端 | |

**User's choice:** Flutter App ConversationService 改为调 Server HTTP 接口

---

## Claude's Discretion

- Relay 向 Server sync API 发起请求的具体 HTTP 客户端实现
- `gateway_sync_cursors` 更新的事务粒度
- app/schedule/ 定时任务的具体执行时间窗口
- Server gateway_runtime_events 查询接口分页大小默认值

## Deferred Ideas

- Relay RPC 读路径 fallback：用户明确不保留
- 多 Gateway 产生相同 session id 的多主场景：session id 全局唯一，先不考虑
- Chat 内容团队共享权限与审计：deferred，Phase 12 只做 account/workspace 隔离
