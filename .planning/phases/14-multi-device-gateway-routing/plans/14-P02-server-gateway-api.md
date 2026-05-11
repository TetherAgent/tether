---
phase: 14-multi-device-gateway-routing
plan: 02
type: execute
wave: 2
depends_on: [14-P01]
files_modified:
  - apps/server/app/service/runtime.ts
  - apps/server/app/service/gatewayRepository.ts
  - apps/server/app/service/gateway.ts
  - apps/server/app/controller/gateway-auth.ts
  - apps/server/app/controller/gateway.ts
  - apps/server/app/router.ts
autonomous: true
requirements: [GATEWAY-MULTI-02]
must_haves:
  truths:
    - "POST /api/server/gateway-auth/bind 接受 deviceKey/hostname/port 参数，按 device_key upsert，不覆盖已有 name"
    - "GET /api/server/gateways 返回当前用户自己的全部 Gateway 列表"
    - "GatewayRecord 类型包含 deviceKey, hostname, localPort, status 支持 'revoked'"
  artifacts:
    - path: "apps/server/app/service/runtime.ts"
      provides: "扩展 GatewayRecord 类型"
    - path: "apps/server/app/service/gatewayRepository.ts"
      provides: "upsertGatewayByDeviceKey, loadGatewaysByUserId, gatewayFromRow 扩展"
    - path: "apps/server/app/service/gateway.ts"
      provides: "bindGatewayForUser 重写为 upsert-by-device-key"
    - path: "apps/server/app/controller/gateway-auth.ts"
      provides: "bind() 读取 deviceKey/hostname/port"
    - path: "apps/server/app/router.ts"
      provides: "GET /api/server/gateways 路由注册"
  key_links:
    - from: "gateway-auth.ts controller"
      to: "gateway.ts service (bindGatewayForUser)"
      via: "ctx.service.gateway.bindGatewayForUser"
    - from: "gatewayRepository.ts upsertGatewayByDeviceKey"
      to: "MySQL uq_gateways_device_key"
      via: "INSERT ... ON DUPLICATE KEY UPDATE"
---

<objective>
扩展服务端 Gateway 绑定流程支持 device_key upsert，并新增 GET /api/server/gateways 接口返回用户自己的 Gateway 列表。

Purpose: Web 需要 Gateway 列表才能渲染选择器（Plan 06）；CLI 登录需要 device_key 传到服务端（Plan 03）。
Output: 扩展后的 repository/service/controller + 新路由
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md
@/Users/dream/code/tether/apps/server/CLAUDE.md

<interfaces>
<!-- 当前 GatewayRecord — apps/server/app/service/runtime.ts lines 46-55 -->
export type GatewayRecord = {
  id: string;
  accountId: string;
  userId: string;
  name: string;
  status: 'online' | 'offline';   // 需要加 | 'revoked'
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
  // 缺少: deviceKey, hostname, localPort
};

<!-- 当前 gatewayRepository.ts saveGateway SQL (line 37-47) -->
INSERT INTO gateways (account_id, device_id, user_id, admin_user_id, name, status, last_seen_at, ...)
ON DUPLICATE KEY UPDATE -- 依赖旧 uq_gateways_account_user，008 migration 后已删除
  name = VALUES(name),  -- D-08: 不应在 UPDATE 时覆盖 name

<!-- 当前 gatewayFromRow (line 24) -->
status: row.status === 'offline' ? 'offline' : 'online'
-- 需要支持 'revoked': row.status === 'offline' ? 'offline' : row.status === 'revoked' ? 'revoked' : 'online'

<!-- 当前 bindGatewayForUser (gateway.ts lines 90-142) -->
// 用 loadGatewayByUserId (按 userId 查第一条) -- 008 后应改为按 device_key 查
// line 105: gateway.name = input.gatewayName ?? gateway.name -- D-08: UPDATE 时禁止覆盖 name

<!-- 路由文件 apps/server/app/router.ts: GET /api/server/gateways 不存在，需新增 -->
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 扩展 GatewayRecord 类型 + gatewayRepository</name>
  <files>
    apps/server/app/service/runtime.ts
    apps/server/app/service/gatewayRepository.ts
  </files>
  <action>
    **runtime.ts（lines 46-55）：**
    扩展 GatewayRecord 类型：
    ```typescript
    export type GatewayRecord = {
      id: string;
      accountId: string;
      userId: string;
      name: string;
      deviceKey?: string;        // 新增 D-01
      hostname?: string;         // 新增 D-03
      localPort?: number;        // 新增 D-03
      status: 'online' | 'offline' | 'revoked';  // 新增 'revoked' D-04
      lastSeenAt: number;
      createdAt: number;
      updatedAt: number;
    };
    ```

    **gatewayRepository.ts：**

    1. **修改 gatewayFromRow（line 18-28）：**
       - 新增映射: `deviceKey: row.device_key ? String(row.device_key) : undefined`
       - 新增映射: `hostname: row.hostname ? String(row.hostname) : undefined`
       - 新增映射: `localPort: row.local_port ? Number(row.local_port) : undefined`
       - 修改 status 映射: `row.status === 'offline' ? 'offline' : row.status === 'revoked' ? 'revoked' : 'online'`

    2. **新增 upsertGatewayByDeviceKey 方法**（替代 saveGateway 用于 device_key upsert）：
       ```typescript
       public async upsertGatewayByDeviceKey(gateway: GatewayRecord): Promise<string> {
         const { ctx } = this;
         if (!this.mysqlModeEnabled()) {
           // runtime fallback: 按 userId + deviceKey 查找或创建
           const store = ctx.service.runtime.runtimeStore();
           const existing = [...store.gateways.values()].find(
             g => g.userId === gateway.userId && g.deviceKey === gateway.deviceKey
           );
           if (existing) {
             existing.hostname = gateway.hostname;
             existing.localPort = gateway.localPort;
             existing.status = gateway.status;
             existing.lastSeenAt = gateway.lastSeenAt;
             existing.updatedAt = gateway.updatedAt;
             return existing.id;
           }
           store.gateways.set(gateway.id, gateway);
           return gateway.id;
         }
         // MySQL: INSERT ... ON DUPLICATE KEY UPDATE (uq_gateways_device_key)
         // D-08: UPDATE 时只更新 hostname/local_port/status/last_seen_at/updated_at，不更新 name
         const result = await ctx.service.db.query(
           `INSERT INTO gateways (
             account_id, user_id, name, device_key, hostname, local_port, status, last_seen_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000), FROM_UNIXTIME(? / 1000))
           ON DUPLICATE KEY UPDATE
             id = LAST_INSERT_ID(id),
             hostname = VALUES(hostname),
             local_port = VALUES(local_port),
             status = VALUES(status),
             last_seen_at = VALUES(last_seen_at),
             updated_at = VALUES(updated_at)`,
           [
             gateway.accountId, gateway.userId, gateway.name,
             gateway.deviceKey ?? null, gateway.hostname ?? null, gateway.localPort ?? null,
             gateway.status, gateway.lastSeenAt, gateway.createdAt, gateway.updatedAt
           ]
         );
         return String((result as { insertId: number }).insertId);
       }
       ```

    3. **新增 loadGatewayByDeviceKey 方法**（按 userId + deviceKey 查单条）：
       ```typescript
       public async loadGatewayByDeviceKey(userId: string, deviceKey: string): Promise<GatewayRecord | undefined> {
         const { ctx } = this;
         if (!this.mysqlModeEnabled()) {
           return [...ctx.service.runtime.runtimeStore().gateways.values()].find(
             g => g.userId === userId && g.deviceKey === deviceKey
           );
         }
         const rows = await ctx.service.db.query(
           'SELECT * FROM gateways WHERE user_id = ? AND device_key = ? LIMIT 1',
           [userId, deviceKey]
         );
         const row = (rows as Record<string, unknown>[])[0];
         return row ? this.gatewayFromRow(row) : undefined;
       }
       ```

    4. **新增 loadGatewaysByUserId 方法**（用于 GET /api/server/gateways，返回列表）：
       ```typescript
       public async loadGatewaysByUserId(userId: string): Promise<GatewayRecord[]> {
         const { ctx } = this;
         if (!this.mysqlModeEnabled()) {
           return [...ctx.service.runtime.runtimeStore().gateways.values()]
             .filter(g => g.userId === userId);
         }
         const rows = await ctx.service.db.query(
           'SELECT * FROM gateways WHERE user_id = ? ORDER BY created_at ASC',
           [userId]
         );
         return (rows as Record<string, unknown>[]).map(row => this.gatewayFromRow(row));
       }
       ```

    保留 saveGateway、loadGatewayByUserId、loadGatewayById 等现有方法不删除（refreshGatewayToken 等仍在使用）。
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/server typecheck
    ```
  </verify>
  <done>
    GatewayRecord 含 deviceKey/hostname/localPort/status='revoked'；
    repository 新增四个方法；gatewayFromRow 映射正确；typecheck 通过。
  </done>
</task>

<task type="auto">
  <name>Task 2: 更新 gateway service + controller + 新增 GET 路由</name>
  <files>
    apps/server/app/service/gateway.ts
    apps/server/app/controller/gateway-auth.ts
    apps/server/app/controller/gateway.ts
    apps/server/app/router.ts
  </files>
  <action>
    **gateway.ts service — 重写 bindGatewayForUser（lines 90-142）：**

    更新 BindGatewayForUserInput 类型加入 deviceKey/hostname/port：
    ```typescript
    type BindGatewayForUserInput = {
      accountId: string;
      userId: string;
      deviceKey: string;          // 必填
      gatewayName?: string;       // 用作 name（新建时）
      hostname?: string;
      localPort?: number;
      ip?: string;
      userAgent?: string;
    };
    ```

    重写 bindGatewayForUser：
    - 用 `ctx.service.gatewayRepository.loadGatewayByDeviceKey(input.userId, input.deviceKey)` 查找已有 Gateway
    - 若不存在（新建）: name 默认 input.hostname ?? 'local-gateway'（per D-08 new: name = hostname）
    - 若已存在（更新）: **不更新 name**（per D-08），只更新 hostname/localPort/status/lastSeenAt
    - 调用 `ctx.service.gatewayRepository.upsertGatewayByDeviceKey(gateway)` 写入
    - 返回结构保持不变（gateway, accountId, gatewayAccessToken, gatewayRefreshToken）

    **gateway-auth.ts controller — 更新 bind()：**

    读取 body 中的 deviceKey/hostname/port 并传给 service：
    ```typescript
    public async bind(): Promise<void> {
      const { ctx } = this;
      const auth = ctx.state.auth as AuthScope | undefined;
      const body = ctx.request.body as Record<string, string | number | undefined>;
      const deviceKey = typeof body.deviceKey === 'string' ? body.deviceKey : '';
      if (!deviceKey) {
        ctx.throw(400, 'device_key_required');
      }
      const data = await ctx.service.gateway.bindGatewayForUser({
        accountId: auth?.accountId ?? '',
        userId: auth?.userId ?? '',
        deviceKey,
        gatewayName: typeof body.hostname === 'string' ? body.hostname : undefined,
        hostname: typeof body.hostname === 'string' ? body.hostname : undefined,
        localPort: typeof body.port === 'number' ? body.port : undefined,
        ip: ctx.ip,
        userAgent: ctx.get('user-agent')
      });
      ctx.success(data);
    }
    ```

    **gateway.ts controller — 新增 list() 方法**（用于 GET /api/server/gateways）：
    ```typescript
    public async list(): Promise<void> {
      const { ctx } = this;
      const auth = ctx.state.auth as { userId?: string } | undefined;
      const userId = auth?.userId ?? '';
      const gateways = await ctx.service.gatewayRepository.loadGatewaysByUserId(userId);
      ctx.success(gateways.map(g => ({
        gatewayId: g.id,
        deviceKey: g.deviceKey,
        hostname: g.hostname,
        name: g.name,
        status: g.status,
        lastSeenAt: g.lastSeenAt
      })));
    }
    ```

    **router.ts — 新增 GET /api/server/gateways：**
    在 Session 数据读取区块前（line 39 附近），添加：
    ```typescript
    router.get('/api/server/gateways', requireNormalAccess, controller.gateway.list);
    ```
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/server typecheck
    pnpm --filter @tether/server test
    ```
    手动验证（需 MySQL 模式运行）：
    ```bash
    # 用有效 normal_client_access token 调用
    curl -X GET http://127.0.0.1:4800/api/server/gateways \
      -H "authorization: Bearer $TOKEN"
    # 预期: { code: 0, data: [...] }
    ```
  </verify>
  <done>
    - bindGatewayForUser 按 device_key upsert，不覆盖已有 name
    - GET /api/server/gateways 返回当前用户的 Gateway 列表（按 D-14 字段）
    - typecheck 和现有测试通过
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Web browser → POST /api/server/gateway-auth/bind | 用户已登录，但 deviceKey 字段来自浏览器 URL（从 CLI 传入），需校验格式 |
| GET /api/server/gateways | 已有 requireNormalAccess，防止未认证访问；但 userId 从 ctx.state.auth 取，不接受用户传入 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-P02-01 | Spoofing | POST /api/server/gateway-auth/bind: deviceKey 由客户端传入 | accept | deviceKey 是设备自生成标识符，不用于鉴权；恶意伪造只影响该用户自己的 Gateway 记录，不跨账号 |
| T-14-P02-02 | Information Disclosure | GET /api/server/gateways 返回 hostname/localPort | mitigate | 路由挂 requireNormalAccess；userId 来自 JWT，不接受用户传入参数 |
| T-14-P02-03 | Elevation of Privilege | bindGatewayForUser 按 accountId+userId upsert | mitigate | accountId 和 userId 来自 ctx.state.auth（JWT 解码），不接受 body 传入 |
</threat_model>

<verification>
```bash
pnpm --filter @tether/server typecheck
pnpm --filter @tether/server test
```
</verification>

<success_criteria>
- `POST /api/server/gateway-auth/bind` 接受 deviceKey/hostname/port，按 (accountId, userId, deviceKey) upsert
- 已有 Gateway 重复登录不覆盖 name（D-08）
- `GET /api/server/gateways` 返回 gatewayId/deviceKey/hostname/name/status/lastSeenAt
- `GatewayRecord.status` 支持 'revoked'（BC-4 修复）
- typecheck 和测试全过
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-02-SUMMARY.md`，记录：
- GatewayRecord 新增字段
- 新增的 repository 方法
- GET /api/server/gateways 路由
- bindGatewayForUser 的 upsert 语义变化
</output>
