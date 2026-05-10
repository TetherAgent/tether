# 多设备 Gateway 路由方案

状态：Working  
创建时间：2026-05-11  
范围：多账户登录、同一账号多电脑 Gateway 绑定、Web/Relay 路由边界  
目标：允许同一账号在多台电脑登录并绑定多个 Gateway，同时杜绝请求串到其他用户或其他电脑。

## 结论

一个账号可以绑定多个 Gateway，但不能再用 `accountId + workspaceId` 或单纯 `userId`
自动选择 Gateway。

长期边界应拆成两层：

| 边界 | 字段 | 作用 |
| --- | --- | --- |
| 权限归属 | `accountId + workspaceId + userId` | 判断这个用户是否有权看到某个 Gateway / Session |
| 路由归属 | `gatewayId` | 决定新请求、控制帧、会话续写发到哪台电脑 |
| 设备身份 | `deviceId` | 稳定识别一台电脑，用于 Gateway upsert、展示名和默认选择 |

核心规则：

```text
权限校验看 account/workspace/user
实际路由只认 gatewayId
deviceId 只用于设备绑定、展示和默认选择，不作为 Relay 路由字段
```

## 要解决的问题

当前同一 `accountId + workspaceId` 下可能有多个用户、多个 Gateway 同时在线。

如果 Relay 或 Web 只看到“这个 workspace 有 Gateway 在线”，就可能出现：

- user 3 的 Web 收到 user 5 的 `gateway.status connected`
- 同一个用户在 MacBook 和 Mac mini 都启动 Gateway，新会话不知道发到哪台电脑
- 某台电脑的会话离线，但另一台电脑在线，UI 误显示可继续

因此不能把 `account/workspace` 当作 Gateway 路由边界。

## 数据模型

建议把 Gateway 记录设计成“设备绑定 + 在线状态”。

```text
gateways
- id
- account_id
- workspace_id
- user_id
- device_id
- name
- hostname
- local_port
- status
- last_seen_at
- created_at
- updated_at
- revoked_at
```

唯一约束：

```text
unique(account_id, workspace_id, user_id, device_id)
```

含义：

- 同一个用户在同一个 workspace 下，同一台电脑只有一个稳定 Gateway 记录。
- 同一台电脑重复登录不新建 Gateway，而是更新原 Gateway 的 `hostname / local_port / status / last_seen_at`。
- 同一个用户多台电脑会有多条 Gateway 记录，每条有不同 `deviceId`。

## 本机 deviceId

Gateway 第一次启动时生成本机 `deviceId`，保存在本机持久文件或 SQLite。

候选位置：

```text
~/.tether/device.json
~/.tether/tether.db
```

示例：

```json
{
  "deviceId": "dev_xxx",
  "deviceName": "dreamdeMacBook-Pro.local"
}
```

之后这台电脑每次 `tether gateway login` 都携带同一个 `deviceId`。

## Gateway 登录流程

目标：callback 返回的 `gatewayId` 必须由服务端根据当前登录用户和本机 `deviceId`
确定，不能由前端或本机随意指定。

流程：

1. 本机 Gateway 读取或生成 `deviceId`。
2. 打开 auth 页面时带上本机信息：

```text
/gateway-auth?deviceId=dev_xxx&hostname=dreamdeMacBook-Pro.local&port=55424
```

3. 用户在 Server 登录完成后，Server 以当前登录态为准执行 upsert：

```text
find gateway by accountId + workspaceId + userId + deviceId
if exists:
  update hostname/local_port/status/last_seen_at
else:
  create gateway
```

4. Server callback 返回稳定的 `gatewayId` 和 gateway token。

服务端签发的 `gateway_access` token 必须包含：

```text
accountId
workspaceId
userId
gatewayId
deviceId
tokenClass = gateway_access
```

## Web 选择 Gateway

Web 登录后不应自动猜 Gateway，而是先读取当前用户自己的 Gateway 列表：

```text
GET /api/server/gateways
```

只返回当前 `accountId + workspaceId + userId` 下的 Gateway：

```json
[
  {
    "gatewayId": "1",
    "deviceId": "dev_macbook",
    "name": "dreamdeMacBook-Pro.local",
    "hostname": "dreamdeMacBook-Pro.local",
    "status": "online",
    "lastSeenAt": "2026-05-11T00:00:00.000Z",
    "isLocal": true
  }
]
```

前端状态：

| Gateway 数量 | UI 行为 |
| --- | --- |
| 0 个 online | 显示 `Gateway 未连接`，禁止新建会话 |
| 1 个 online | 可以默认选中它，但仍要显示当前 Gateway 名称 |
| 多个 online | 必须显示 Gateway 选择器，当前选中项决定新会话发到哪台电脑 |
| 当前会话所属 Gateway offline | 历史可读，控制和输入禁用 |

## Relay 路由规则

Relay 最终只按 `gatewayId` 做新请求路由。

规则：

```text
client token 有 gatewayId:
  只能绑定这个 gateway

client token 没有 gatewayId:
  可以读取 gateway/session 列表
  不能创建新会话
  不能 list-providers
  不能 cwd-suggest
  不能发送 sessionId=null 的 client.chat

session 已存在:
  按 session.gatewayId 路由
```

禁止：

```text
同 workspace 找第一个 online gateway
同 userId 找第一个 online gateway
gatewayId 不存在时 fallback 到 account/workspace
```

## 新会话创建

新会话必须带明确目标 Gateway。

示例 frame：

```json
{
  "type": "client.chat",
  "sessionId": null,
  "gatewayId": "1",
  "provider": "claude",
  "model": "sonnet",
  "cwd": "~/code/tether",
  "message": "创建个 demo"
}
```

Relay / Server 必须校验：

```text
gateway.accountId == token.accountId
gateway.workspaceId == token.workspaceId
gateway.userId == token.userId
gateway.status == online
```

校验通过后，创建出来的 session 必须记录：

```text
session.gatewayId = gatewayId
session.accountId = accountId
session.workspaceId = workspaceId
session.userId = userId
```

后续这个 session 永远回到它自己的 `session.gatewayId`，不因用户切换当前 Gateway 而改变。

## 会话列表和详情页

会话列表需要展示所属 Gateway：

```text
测试
claude · ~/code/tether · dreamdeMacBook-Pro.local
```

如果 Gateway 离线：

```text
测试
claude · ~/code/tether · dreamdeMacBook-Pro.local · Gateway 离线
```

会话详情页规则：

- 当前会话运行在哪台 Gateway，就显示哪台。
- 当前选中的 Gateway 不等于 session.gatewayId 时，不改变会话路由。
- session.gatewayId 对应 Gateway offline 时，历史可读，输入框禁用并显示离线状态。

## 本机自动选择

本机自动选择只是体验优化，不是安全边界。

可选方案：

1. Gateway 本机服务暴露只读 identity：

```text
GET http://127.0.0.1:<port>/identity
```

返回：

```json
{
  "deviceId": "dev_xxx",
  "gatewayId": "1",
  "hostname": "dreamdeMacBook-Pro.local"
}
```

2. Web 打开后尝试访问本机 identity。
3. Web 把候选 `gatewayId/deviceId` 交给 Server 校验。
4. Server 确认该 Gateway 属于当前登录用户后，Web 自动选中它。

注意：

- 不能因为浏览器能访问本机端口就信任 identity。
- 最终仍必须由 Server / Relay 校验 `gatewayId` 是否属于当前 token scope。

## 安全原则

前端传来的 `gatewayId` 只能表达“用户想用哪个 Gateway”，不能直接信任。

每次使用前都必须由 Server / Relay 校验：

```text
gateway.accountId == token.accountId
gateway.workspaceId == token.workspaceId
gateway.userId == token.userId
gateway.revokedAt is null
gateway.status == online
```

禁止让普通 Web client 通过 `gatewayId` 访问其他用户、其他 workspace 或已撤销 Gateway。

## 设计补充和容易漏掉的边界

### 普通 Web token 不长期绑定 Gateway

普通登录 token 只代表用户身份，不建议长期携带 `gatewayId`。

更合理的方式：

1. Web 用普通登录 token 读取当前用户 Gateway 列表。
2. 用户选择某个 Gateway。
3. Web 向 Server 换一个短期 `ws_ticket` 或 Relay scope，里面带明确 `gatewayId`。
4. Relay 用短期 scope 绑定这个 Gateway。

这样用户切换 Gateway 时，不需要刷新主登录 token，也不会把设备选择写死在用户身份里。

### 本机 identity 需要 Origin / nonce 防护

`127.0.0.1:<port>/identity` 不能随便被任意网页读取。

要求：

- 只允许可信 Origin，例如生产域名和本地开发域名。
- 不返回任何 access token / refresh token / relay secret。
- 可选增加一次性 nonce：Web 先从 Server 获取 nonce，本机 identity 返回时带 nonce，Server 再校验。

本机 identity 只能回答“这台机器可能有哪个 Gateway”，不能作为权限证明。

### Gateway 选择需要持久化，但必须可失效

Web 可以把当前选择的 `gatewayId` 存到 localStorage 或 IndexedDB，提升刷新体验。

但每次使用前必须重新校验：

```text
selected gatewayId exists in GET /api/server/gateways
selected gateway belongs to current account/workspace/user
selected gateway not revoked
selected gateway online or lastSeenAt within timeout
```

如果校验失败，必须清掉本地选择并要求用户重新选择。

### 多标签页要同步选择

同一个浏览器可能打开多个 Tether tab。

要求：

- 一个 tab 切换 Gateway 后，其他 tab 应通过 `storage` event 或 BroadcastChannel 同步当前选择。
- 每次发送新会话类请求前，仍以最新选择和 Server 校验结果为准。
- 如果不同 tab 分别选择不同 Gateway，UI 必须明确显示当前 tab 的选择，不能静默混用。

### online/offline 不能只看当前 WebSocket

Gateway 在线状态应由多信号决定：

```text
Relay Gateway WS 当前连接状态
Server gateways.status
last_seen_at / heartbeat timeout
revoked_at
```

Relay 重启、网络断开、Gateway 异常退出时，Server 表可能短时间保留旧 `online`。
前端展示应结合 `lastSeenAt` 做超时判断，避免长期误显示在线。

### 同一 device 重复登录和连接替换

`unique(account_id, workspace_id, user_id, device_id)` 后，同设备只能有一个稳定 Gateway 记录。

建议规则：

- 同一 device 再次登录：复用原 `gatewayId`，更新 token 和 last_seen。
- 同一 `gatewayId` 新 Gateway WS 连接上来：Relay 关闭旧连接，新的连接接管。
- 同一 device 不允许两个 active gateway 同时控制同一 `gatewayId`。

### 会话创建要处理断线 race

用户点击发送时 Gateway 可能刚显示 online，但 Relay 转发前已经断开。

要求：

- Relay 转发前再次确认 `gatewayId` 在线。
- 转发失败返回明确错误，例如 `gateway_unavailable` 或 `gateway_disconnected`。
- 前端不能创建假会话；只能显示失败状态并允许用户重试或切换 Gateway。

### Server DB sync 也必须校验 gatewayId

Relay 将 `gateway.sessions` / `gateway.event` 同步到 Server 时，Server 不能只按
`accountId/workspaceId` 接收。

Server 写库前必须校验：

```text
frame.gatewayId == gateway token scope gatewayId
session.gatewayId == frame.gatewayId
session.accountId == scope.accountId
session.workspaceId == scope.workspaceId
session.userId == scope.userId
```

写入的 session/event 必须带 `gateway_id`，后续读历史和控制路由都依赖它。

### 手机不会有本机自动选择

手机打开 Web 时，`127.0.0.1` 是手机自己，不是电脑 Gateway。

因此：

- 手机默认必须使用手动 Gateway 选择器。
- 本机 identity 自动选择只适用于电脑本机浏览器。
- 手机端可以记住上次选择，但仍要通过 Server Gateway 列表校验。

### workspace 切换必须重新选择 Gateway

Gateway 属于具体 workspace。

如果用户切换 workspace：

- 旧 workspace 的 `gatewayId` 不能沿用。
- Web 必须重新拉取该 workspace 下的 Gateway 列表。
- 当前选择失效时，清空 selected gateway 并显示 `请选择 Gateway`。

## 分阶段落地

### 第一步：设备绑定和稳定 Gateway

- Gateway 本机生成并保存 `deviceId`。
- `gateway-auth` 带 `deviceId/hostname/port`。
- Server 按 `account/workspace/user/deviceId` upsert Gateway。
- callback 返回稳定 `gatewayId`。

### 第二步：Gateway 列表 API

- 新增 `GET /api/server/gateways`。
- 只返回当前用户自己的 Gateway。
- 返回 online/offline、hostname、lastSeenAt、display name。

### 第三步：Relay 强制 gatewayId 路由

- client auth 不再自动按 `userId` 绑定 Gateway。
- `client.chat sessionId=null` / `list-providers` / `cwd-suggest` 必须有明确 `gatewayId`。
- `gateway.status` 不再表示“workspace 有 Gateway”，而是具体 Gateway 的状态。

### 第四步：Web Gateway 选择器

- 顶部显示当前 Gateway。
- 多 Gateway 在线时允许切换。
- 没有 Gateway 时禁用新会话。
- 会话详情显示 `session.gatewayId` 对应设备。

### 第五步：本机自动选择

- 增加本机 identity 探测。
- 探测结果只作为候选。
- Server 校验后自动选中。

具体设计：

1. Gateway 本机启动时暴露只读 identity 接口，只监听 `127.0.0.1`：

```text
GET http://127.0.0.1:<local_port>/identity
```

2. identity 只返回非敏感设备信息，不返回 access token / refresh token：

```json
{
  "deviceId": "dev_xxx",
  "gatewayId": "1",
  "hostname": "dreamdeMacBook-Pro.local",
  "localPort": 55424
}
```

3. Web 打开后读取 `GET /api/server/gateways`，拿到当前用户有权访问的 Gateway 列表。
4. Web 再尝试探测本机 identity。
5. 如果本机 identity 的 `gatewayId/deviceId` 出现在 Server 返回的 Gateway 列表中，自动选中它。
6. 如果探测不到本机 identity，或 identity 不属于当前登录用户，则不自动选择，让用户手动选 Gateway。

安全要求：

- 本机 identity 只能作为“候选”，不能作为登录态或权限证明。
- Web 不能因为访问到了 `127.0.0.1` 就直接信任该 Gateway。
- 最终能否选择和路由，仍以 Server / Relay 校验 `accountId + workspaceId + userId + gatewayId` 为准。
- 如果多个本机端口都返回 identity，只能选择 Server 列表里属于当前用户且 `status=online` 的那一个；无法唯一确定时交给用户手动选择。

验收：

- MacBook 本机打开 Web 时，如果本机 Gateway 已登录当前账号，顶部自动选中 MacBook 的 Gateway。
- MacBook 本机打开 Web 时，如果当前登录的是另一个账号，不自动选中这台 Gateway。
- 同一账号两台电脑都在线时，每台电脑本机 Web 默认选中自己的 Gateway。
- 本机 identity 服务不可用时，Web 仍可通过手动 Gateway 选择器正常使用。
- identity 响应不包含任何 token。

## 验收标准

- 同一账号在两台电脑启动 Gateway，Web 可看到两个 Gateway，并能手动选择。
- 新建会话总是创建到当前选择的 Gateway。
- 已存在会话始终回到 `session.gatewayId`，不会因为当前选择切换而改路由。
- user 3 的 Web 不会收到 user 5 的 `gateway.status connected`。
- 同一 user 的 MacBook 会话不会因为 Mac mini 在线而显示可控制。
- 没有明确 `gatewayId` 时，新建会话类请求返回 `gateway_required`。
- 清数据库不是必要步骤；重启 Relay/Gateway 后仍保持稳定设备绑定。
