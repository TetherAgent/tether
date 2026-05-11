# Phase 14: Multi-device Gateway Routing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 14-multi-device-gateway-routing
**Areas discussed:** gateways 表 Schema、Gateway 登录流程、Relay 路由收紧、Web Gateway 选择器

---

## gateways 表 Schema

| Option | Description | Selected |
|--------|-------------|----------|
| 本机字符串 device_key | 新增 device_key VARCHAR，unique key 改为 (account_id, user_id, device_key)，devices 表 FK 保留但不参与路由 | ✓ |
| 复用 devices 表 ID | 先 upsert devices 表拿 BIGINT id，再用作 unique key，改动链更长 | |

**User's choice:** 本机字符串（dev_xxx 格式）

| Option | Description | Selected |
|--------|-------------|----------|
| 加 hostname + local_port | 新增字段，Gateway 登录时更新，用于 Web 展示 | ✓ |
| 不加 | 本机探测逻辑后续再说 | |

**User's choice:** 加

| Option | Description | Selected |
|--------|-------------|----------|
| 直接替换旧 unique key | 删除 uq_gateways_account_user，新增 uq_gateways_device_key | ✓ |
| 保留旧 key + 加新 key | 两个 unique key 并存，兼容旧流程 | |

**User's choice:** 直接替换

| Option | Description | Selected |
|--------|-------------|----------|
| 用 status 字段表示撤销 | status='revoked'，不新增列 | ✓ |
| 加 revoked_at DATETIME | 新增可空列，可审计撤销时间 | |

**User's choice:** 用 status 字段

**Notes:** workspace_id 正在从 Gateway 链路移除（相关 commit 已在进行中），unique key 不含 workspace_id，改为 (account_id, user_id, device_key)。

---

## Gateway 登录流程

| Option | Description | Selected |
|--------|-------------|----------|
| ~/.tether/device.json | 轻量独立文件，与主数据库分离，重装不丢失 | ✓ |
| ~/.tether/tether.db | 写入本地 SQLite，删 DB 会丢失设备身份 | |

**User's choice:** device.json

| Option | Description | Selected |
|--------|-------------|----------|
| URL 参数 | 打开 /gateway-auth 时带 ?deviceKey=&hostname=&port=，Server 直接读取 | ✓ |
| callback 后再 POST | 用户登录成功后 Gateway 再发 POST，多一步 | |

**User's choice:** URL 参数

| Option | Description | Selected |
|--------|-------------|----------|
| upsert by device_key | 按 (account_id, user_id, device_key) 查找，存在更新，不存在新建 | ✓ |
| upsert by account+user | 按旧逻辑，不支持多设备 | |

**User's choice:** upsert by device_key（workspace_id 从 key 中移除）

| Option | Description | Selected |
|--------|-------------|----------|
| gatewayId + gateway token | 返回稳定 gatewayId 和 access token | ✓ |
| gatewayId + token + refresh token | 额外返回 refresh token | |

**User's choice:** gatewayId + gateway token

**Notes:** 用户提出 auth.json 里的 gatewayId/accountId 字段与 JWT payload 重复，决定简化 auth.json，只保留 serverUrl/accessToken/refreshToken/expiresAt，其余字段从 token decode 获取。这是有关联影响的重构，planner 需要审计所有直接读取这些字段的调用点。

---

## Relay 路由收紧

| Option | Description | Selected |
|--------|-------------|----------|
| frame 里带 gatewayId | client.chat 等帧里加 gatewayId 字段，Relay 直接读取 | ✓ |
| ws_ticket 里带 | 申请带 gatewayId 的短期 ticket，切换时需重新申请 | |

**User's choice:** frame 里带

| Option | Description | Selected |
|--------|-------------|----------|
| 返回 gateway_required 错误 | 无 gatewayId 直接报错，不做 fallback | ✓ |
| 保留 firstGatewayForScope fallback | 维持现有行为，但违反多租户隔离规则 | |

**User's choice:** 返回错误

| Option | Description | Selected |
|--------|-------------|----------|
| 校验 gatewayId 归属 | 确认 gateway.scope.accountId == client.scope.accountId | ✓ |
| 不校验 | 直接按 gatewayId 转发，有安全隐患 | |

**User's choice:** 校验

| Option | Description | Selected |
|--------|-------------|----------|
| list-providers/cwd-suggest 也要 gatewayId | 所有需要 Gateway 响应的帧规则一致 | ✓ |
| list-providers 可全局查 | 不需要指定设备 | |

**User's choice:** 一致，都要带

---

## Web Gateway 选择器

| Option | Description | Selected |
|--------|-------------|----------|
| 只返回当前 user 自己的 | 按 accountId + userId 过滤 | ✓ |
| 返回全账号下所有 Gateway | 按 accountId 查，与 v0.3 单用户模型不匹配 | |

**User's choice:** 只返回当前 user 自己的

**Notes:** 用户提出 Gateway 需要支持用户可编辑别名（name 字段）——登录时默认 hostname，可改成"公司 Mac"等。前端展示优先别名，无别名则用 hostname。

| Option | Description | Selected |
|--------|-------------|----------|
| /chats 顶部 | 放在聊天界面顶部 header | ✓ |
| 全局导航栏 | 所有页面可见，但当前只有 /chats 用到 Gateway | |

**User's choice:** /chats 顶部

| Option | Description | Selected |
|--------|-------------|----------|
| 历史可读，输入禁用 | Gateway 离线时展示历史，禁用输入框 | ✓ |
| 整个会话隐藏 | 离线 Gateway 的会话不在列表显示 | |
| 保持可点击但加锁 | 进入后显示 banner，控制全禁用 | |

**User's choice:** 历史可读，输入禁用

| Option | Description | Selected |
|--------|-------------|----------|
| 不做本机探测 | 手动选择即可，避开 mixed content 问题 | ✓ |
| 做本机探测 | 尝试 127.0.0.1/identity，需解决 HTTPS 问题 | |

**User's choice:** 不做

**Notes:** 用户说明自己是远程使用场景，127.0.0.1 是客户端自己，本机探测对远程场景无意义。permanently deferred。

---

## Deferred Ideas

- **本机自动探测**（`127.0.0.1/identity`）：远程使用场景无意义，permanently deferred
- **多标签页 Gateway 选择同步**（BroadcastChannel）：体验优化，可后续加
- **Gateway 撤销 UI**：已在 Phase 6 管理后台，本 Phase 只读取 status='revoked' 状态
