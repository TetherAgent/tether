---
phase: 14-multi-device-gateway-routing
plan: 03
type: execute
wave: 2
depends_on: [14-P02]
files_modified:
  - apps/cli/src/main.ts
  - apps/web/src/pages/gateway-auth-page.tsx
  - apps/gateway/src/daemon.ts
  - apps/gateway/src/relay-client.ts
autonomous: true
requirements: [GATEWAY-MULTI-03]
must_haves:
  truths:
    - "tether gateway login 从 device.json 读取/生成 deviceKey，browser URL 携带 deviceKey/hostname/port"
    - "auth.json 简化为 {serverUrl, accessToken, refreshToken, expiresAt}，不再存 gatewayId/accountId"
    - "daemon.ts 和 relay-client.ts 中所有使用 authState.value.gatewayId / authState.value.accountId 的地方改为从 JWT decode"
    - "Gateway 仍能正常连接 Relay（不断线）"
  artifacts:
    - path: "apps/cli/src/main.ts"
      provides: "device.json 读写 + 简化后的 GatewayAuthState 类型 + decodeTokenPayload 扩展"
    - path: "apps/web/src/pages/gateway-auth-page.tsx"
      provides: "读取 deviceKey URL 参数 + POST body 携带 deviceKey"
    - path: "apps/gateway/src/daemon.ts"
      provides: "decodeGatewayToken helper + 简化的 GatewayAuthState 类型 + 3 个 callsite 修复"
    - path: "apps/gateway/src/relay-client.ts"
      provides: "resolveRelayAuth 改为 JWT decode 获取 gatewayId/accountId"
  key_links:
    - from: "CLI performGatewayLogin"
      to: "browser URL /gateway-auth?deviceKey=...&hostname=...&port=..."
      via: "D-07: URL 参数"
    - from: "gateway-auth-page.tsx"
      to: "POST /api/server/gateway-auth/bind body.deviceKey"
      via: "D-08: 服务端按 device_key upsert"
    - from: "daemon.ts decodeGatewayToken"
      to: "accessToken JWT payload.gatewayId"
      via: "base64url split，无外部库"
---

<objective>
原子性地完成以下四件事（必须在同一 Plan 中交付，任何一件不完整都会导致 Gateway 无法连接 Relay）：
1. CLI 新增 device.json 读写，tether gateway login URL 携带 deviceKey
2. Web gateway-auth-page.tsx 读取并转发 deviceKey
3. auth.json 格式简化（CLI + Gateway 两端同步）
4. daemon.ts 4 个 callsite + relay-client.ts 1 个 callsite 改为 JWT decode

Purpose: 多设备支持的核心身份基础——每台设备有稳定 deviceKey，auth.json 瘦身，gatewayId 从 token 中读取。
Output: CLI device.json + 简化的 auth.json + decodeGatewayToken helper + 所有 callsite 修复
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md

<interfaces>
<!-- CLI GatewayAuthState (main.ts lines 141-148) — 需要简化 -->
type GatewayAuthState = {
  serverUrl: string;
  gatewayId: string;    // 删除
  accountId: string;    // 删除
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

<!-- CLI performGatewayLogin (lines 1350-1378) — 关键改动点 -->
// line 1360: browserUrl 当前只有 port 和 hostname，需加 deviceKey
const browserUrl = `${serverUrl}/gateway-auth?port=${port}&hostname=${encodeURIComponent(hostname)}`;
// lines 1369-1376: writeGatewayAuthState 当前写入 gatewayId/accountId
await writeGatewayAuthState({ serverUrl, gatewayId: result.gatewayId, accountId: result.accountId, ... });

<!-- CLI readGatewayAuthState (lines 1466-1483) — 需更新校验 -->
// 当前校验 gatewayId/accountId，简化后去掉这两个字段

<!-- CLI decodeTokenPayload (lines 1490-1498) — 可扩展为泛型 -->
function decodeTokenPayload(token: string): { expiresAt?: unknown } | undefined { ... }

<!-- CLI waitForGatewayAuthCallback (line 1403) -->
type GatewayAuthCallbackResult = {
  gatewayId: string;    // 仍从回调中读取，但不写入 auth.json（从 JWT decode 获取）
  accountId: string;    // 同上
  gatewayAccessToken: string;
  gatewayRefreshToken: string;
};

<!-- daemon.ts GatewayAuthState (lines 46-53) — 需简化 -->
type GatewayAuthState = {
  serverUrl: string;
  gatewayId: string;    // 删除
  accountId: string;    // 删除
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

<!-- daemon.ts callsites needing fix -->
// line 188: actor.payload.gatewayId ?? authState.value.gatewayId
// line 687: authorizeSessionAccess(session, ticketPayload.payload, authState.value.gatewayId)
// line 1083: return { ok: true, payload, gatewayId: authState.value.gatewayId }

<!-- daemon.ts parseGatewayAuthState (lines 1136-1153) — 需移除 gatewayId/accountId 校验 -->
typeof value.gatewayId === 'string' &&   // 删除
typeof value.accountId === 'string' &&   // 删除

<!-- relay-client.ts resolveRelayAuth (lines 1048-1091) — 关键改动点 -->
// line 1070-1071: 校验 gatewayId/accountId 是否为 string
typeof parsed.gatewayId !== 'string' ||   // 改为从 JWT decode
typeof parsed.accountId !== 'string' ||

<!-- gateway-auth-page.tsx (line 23, 49) -->
const hostname = params.get('hostname') ?? 'unknown';  // 需同时读 deviceKey
body: JSON.stringify({ hostname })                      // 需加 deviceKey

<!-- JWT payload 结构 (从 apps/server/app/service/auth.ts issueGatewayTokenBundle 确认包含) -->
{ gatewayId: string, accountId: string, userId: string, tokenClass: 'gateway_access', expiresAt: number, jti: string }
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: CLI — device.json + auth.json 简化 + performGatewayLogin 更新</name>
  <files>apps/cli/src/main.ts</files>
  <action>
    **1. 简化 GatewayAuthState 类型（line 141-148）：**
    删除 gatewayId 和 accountId 字段：
    ```typescript
    type GatewayAuthState = {
      serverUrl: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    ```

    **2. 新增 DeviceState 类型和 device.json 读写函数**（在 GatewayAuthState 后添加）：
    ```typescript
    type DeviceState = {
      deviceKey: string;
      deviceName: string;
    };

    function deviceStatePath(): string {
      return process.env.TETHER_DEVICE_PATH ?? path.join(os.homedir(), '.tether', 'device.json');
    }

    async function loadOrCreateDeviceState(): Promise<DeviceState> {
      const raw = await readFile(deviceStatePath(), 'utf8').catch(() => undefined);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<DeviceState>;
          if (typeof parsed.deviceKey === 'string' && parsed.deviceKey.startsWith('dev_')) {
            return { deviceKey: parsed.deviceKey, deviceName: parsed.deviceName ?? os.hostname() };
          }
        } catch { /* fall through */ }
      }
      // 生成新 deviceKey: dev_ + 随机 12 字节 hex
      const { randomBytes } = await import('crypto');
      const deviceKey = `dev_${randomBytes(12).toString('hex')}`;
      const deviceName = os.hostname();
      const state: DeviceState = { deviceKey, deviceName };
      await mkdir(path.dirname(deviceStatePath()), { recursive: true });
      await writeFile(deviceStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      return state;
    }
    ```

    **3. 扩展 decodeTokenPayload 为泛型（line 1490-1498）：**
    ```typescript
    function decodeTokenPayload(token: string): Record<string, unknown> | undefined {
      const parts = token.split('.');
      if (parts.length !== 3) return undefined;
      try {
        return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
      } catch { return undefined; }
    }
    ```

    **4. 更新 performGatewayLogin（lines 1350-1378）：**
    - 调用 `loadOrCreateDeviceState()` 获取 deviceKey
    - 修改 browserUrl 加 deviceKey：
      ```typescript
      const device = await loadOrCreateDeviceState();
      const browserUrl = `${serverUrl}/gateway-auth?port=${port}&hostname=${encodeURIComponent(hostname)}&deviceKey=${encodeURIComponent(device.deviceKey)}`;
      ```
    - 简化 writeGatewayAuthState 调用（去掉 gatewayId/accountId）：
      ```typescript
      await writeGatewayAuthState({
        serverUrl,
        accessToken: result.gatewayAccessToken,
        refreshToken: result.gatewayRefreshToken,
        expiresAt: payload.expiresAt
      });
      ```
    - GatewayAuthCallbackResult 类型中保留 gatewayId/accountId（仍从回调中读取，但不存入 auth.json）

    **5. 更新 readGatewayAuthState（lines 1466-1483）：**
    移除 gatewayId/accountId 字段的校验：
    ```typescript
    if (
      typeof parsed.serverUrl !== 'string' ||
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      throw new Error('auth.json 格式无效，请重新执行 tether gateway login。');
    }
    ```
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/cli typecheck
    ```
  </verify>
  <done>
    - GatewayAuthState 类型不含 gatewayId/accountId
    - loadOrCreateDeviceState() 存在，在 ~/.tether/device.json 生成/读取 deviceKey
    - performGatewayLogin 的 browserUrl 携带 deviceKey 参数
    - writeGatewayAuthState 只写入四字段
    - typecheck 通过
  </done>
</task>

<task type="auto">
  <name>Task 2: Web gateway-auth-page.tsx — 读取并转发 deviceKey</name>
  <files>apps/web/src/pages/gateway-auth-page.tsx</files>
  <action>
    **修改 gateway-auth-page.tsx：**

    1. **读取 deviceKey URL 参数（line 23 附近）：**
       ```typescript
       const params = new URLSearchParams(location.search);
       const port = params.get('port');
       const hostname = params.get('hostname') ?? 'unknown';
       const deviceKey = params.get('deviceKey') ?? '';  // 新增
       ```

    2. **在 `!port` 检查后添加对 deviceKey 的检查：**
       ```typescript
       if (!deviceKey) {
         return (
           <WebAuthShell title="授权 Gateway" description="缺少设备标识，请重新运行 tether gateway login。">
             <div />
           </WebAuthShell>
         );
       }
       ```

    3. **修改 authorize 函数的 POST body（line 49）：**
       ```typescript
       body: JSON.stringify({ hostname, deviceKey, port: port ? Number(port) : undefined })
       ```

    4. **更新授权描述（line 71）加入设备信息：**
       保持现有描述风格，description 改为：
       `允许本机 "${hostname}" (${deviceKey.slice(0, 12)}...) 作为 Gateway 连接到你的账号？`

    **注意：** gateway-auth-page.tsx 不需要改 callback URL（callbackUrl 仍包含 gatewayId/accountId 参数，供 CLI 的 waitForGatewayAuthCallback 读取）。
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/web typecheck
    ```
  </verify>
  <done>
    - gateway-auth-page.tsx 从 URL 参数读取 deviceKey
    - POST body 包含 deviceKey
    - 缺少 deviceKey 时显示错误提示而非继续
    - typecheck 通过
  </done>
</task>

<task type="auto">
  <name>Task 3: Gateway daemon.ts + relay-client.ts — auth.json 简化 + 所有 callsite 修复</name>
  <files>
    apps/gateway/src/daemon.ts
    apps/gateway/src/relay-client.ts
  </files>
  <action>
    **daemon.ts 修改：**

    **1. 简化 GatewayAuthState 类型（lines 46-53）：**
    ```typescript
    type GatewayAuthState = {
      serverUrl: string;
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    };
    ```

    **2. 新增 decodeGatewayToken helper**（在 GatewayAuthState 类型定义后，约 line 55 处插入）：
    ```typescript
    function decodeGatewayToken(token: string): Record<string, unknown> | undefined {
      const parts = token.split('.');
      if (parts.length !== 3) return undefined;
      try {
        return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
      } catch { return undefined; }
    }

    function getGatewayIdentity(authState: GatewayAuthState): { gatewayId: string; accountId: string; userId: string } | undefined {
      const payload = decodeGatewayToken(authState.accessToken);
      if (
        typeof payload?.gatewayId === 'string' &&
        typeof payload?.accountId === 'string' &&
        typeof payload?.userId === 'string'
      ) {
        return { gatewayId: payload.gatewayId, accountId: payload.accountId, userId: payload.userId };
      }
      return undefined;
    }
    ```

    **3. 修复 3 个 callsite：**

    **Callsite A — line 188**（WS ticket 签发时 fallback gatewayId）：
    原: `gatewayId: actor.payload.gatewayId ?? authState.value.gatewayId`
    改:
    ```typescript
    const identity = getGatewayIdentity(authState.value);
    // ...
    gatewayId: actor.payload.gatewayId ?? identity?.gatewayId,
    ```
    （注意：identity 需要在使用处 decode，不重复 decode）

    **Callsite B — line 687**（session ownership check）：
    原: `authorizeSessionAccess(session, ticketPayload.payload, authState.value.gatewayId)`
    改:
    ```typescript
    const identity = getGatewayIdentity(authState.value);
    const ticketOwnership = authorizeSessionAccess(session, ticketPayload.payload, identity?.gatewayId);
    ```

    **Callsite C — line 1083**（authorizeRequest 返回值）：
    原: `return { ok: true, payload, gatewayId: authState.value.gatewayId }`
    改:
    ```typescript
    const identity = getGatewayIdentity(authState.value);
    return { ok: true, payload, gatewayId: identity?.gatewayId };
    ```

    **4. 更新 parseGatewayAuthState（lines 1136-1153）：**
    移除 gatewayId/accountId 字段的存在性校验：
    ```typescript
    function parseGatewayAuthState(raw: string): GatewayAuthState | undefined {
      try {
        const value = JSON.parse(raw) as Partial<GatewayAuthState>;
        if (
          typeof value.serverUrl === 'string' &&
          typeof value.accessToken === 'string' &&
          typeof value.refreshToken === 'string' &&
          typeof value.expiresAt === 'number'
        ) {
          return value as GatewayAuthState;
        }
      } catch {
        return undefined;
      }
      return undefined;
    }
    ```

    **relay-client.ts 修改：**

    **更新 resolveRelayAuth（lines 1048-1091）：**

    在函数体中，读取 auth.json 后，改为 JWT decode 获取 gatewayId/accountId：
    ```typescript
    const raw = await readFile(process.env.TETHER_AUTH_PATH ?? path.join(os.homedir(), '.tether', 'auth.json'), 'utf8').catch(() => undefined);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as {
      accessToken?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.expiresAt !== 'number'
    ) {
      return undefined;
    }
    if (parsed.expiresAt <= Date.now()) {
      return undefined;
    }
    // Decode gatewayId/accountId from JWT payload (no external library)
    const parts = (parsed.accessToken as string).split('.');
    if (parts.length !== 3) return undefined;
    let jwtPayload: Record<string, unknown>;
    try {
      jwtPayload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch { return undefined; }
    if (typeof jwtPayload.gatewayId !== 'string' || typeof jwtPayload.accountId !== 'string') {
      console.error('auth.json accessToken 缺少 gatewayId/accountId，请重新运行 tether gateway login');
      return undefined;
    }
    return {
      gatewayId: jwtPayload.gatewayId,
      token: parsed.accessToken as string,
      scope: {
        accountId: jwtPayload.accountId,
        gatewayId: jwtPayload.gatewayId,
        tokenClass: 'gateway_access',
        expiresAt: parsed.expiresAt as number,
        jti: 'relay-auth-local'
      }
    };
    ```
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/gateway typecheck
    pnpm --filter @tether/gateway test
    ```
    如果本地有 auth.json（非简化格式），验证 Gateway 仍能启动：
    - 旧 auth.json 含 gatewayId/accountId 字段（多余字段）：parseGatewayAuthState 容忍多余字段，仍返回有效
    - 新 auth.json 不含 gatewayId/accountId：通过 JWT decode 获取，仍能连接
  </verify>
  <done>
    - daemon.ts GatewayAuthState 类型不含 gatewayId/accountId
    - getGatewayIdentity() helper 存在并从 JWT 解码身份
    - 3 个 callsite（lines 188, 687, 1083）均改为通过 getGatewayIdentity 获取 gatewayId
    - parseGatewayAuthState 不校验 gatewayId/accountId
    - relay-client.ts resolveRelayAuth 通过 JWT decode 获取 gatewayId/accountId（不从 auth.json 直读）
    - typecheck 通过，Gateway 能正常启动并连接 Relay
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| ~/.tether/device.json | 本机文件，攻击者若能写此文件则已有本机访问权 |
| CLI → browser URL deviceKey | 由本机生成，通过 localhost 回调传给 CLI，不经过公网 |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-P03-01 | Tampering | device.json 被恶意修改 deviceKey | accept | 本机文件安全等同于 auth.json；mode 0o600 设置 |
| T-14-P03-02 | Spoofing | JWT decode 无签名验证 | accept | 仅用于本地身份提取（gatewayId/accountId），token 本身在 Relay 握手时经服务端签名验证 |
| T-14-P03-03 | Information Disclosure | auth.json 明文存储 accessToken | accept | 与现有行为一致；mode 0o600；本机文件安全边界 |
</threat_model>

<verification>
```bash
pnpm --filter @tether/cli typecheck
pnpm --filter @tether/web typecheck
pnpm --filter @tether/gateway typecheck
pnpm --filter @tether/gateway test
```
</verification>

<success_criteria>
- CLI device.json 存在，deviceKey 以 "dev_" 开头
- tether gateway login 的 browser URL 含 deviceKey 参数
- auth.json 只有四字段（serverUrl/accessToken/refreshToken/expiresAt）
- daemon.ts 和 relay-client.ts 通过 JWT decode 获取 gatewayId/accountId，不从 auth.json 直读
- 旧格式 auth.json（含多余字段）仍能被解析（向后兼容）
- 全部 typecheck 通过
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-03-SUMMARY.md`，记录：
- device.json 路径和格式
- auth.json 新格式
- decodeGatewayToken / getGatewayIdentity 位置
- 4 个修复的 callsite 行号（实际行号可能与研究略有偏移）
</output>
