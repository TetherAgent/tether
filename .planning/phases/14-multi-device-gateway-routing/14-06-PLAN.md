---
phase: 14-multi-device-gateway-routing
plan: 06
type: execute
wave: 5
depends_on: [14-P04, 14-P05]
files_modified:
  - apps/web/src/components/chats/gateway-selector.tsx
  - apps/web/src/components/chats/chat-panel.tsx
  - apps/web/src/i18n/messages.ts
autonomous: false
requirements: [GATEWAY-MULTI-06]
must_haves:
  truths:
    - "chats 页面顶部显示当前选中 Gateway 的名称（优先别名，无别名用 hostname）和在线状态"
    - "多台 Gateway 时点击当前 Gateway 名称可切换"
    - "没有选中 Gateway 或选中 Gateway 离线时输入框禁用并显示相应提示"
    - "不做本机自动探测（D-17 永久 defer）"
  artifacts:
    - path: "apps/web/src/components/chats/gateway-selector.tsx"
      provides: "GatewaySelector 组件：列表加载 + 在线状态 + 点击切换"
    - path: "apps/web/src/components/chats/chat-panel.tsx"
      provides: "接入 GatewaySelector + 用 selectedGatewayId 驱动组件 + 离线/无选择输入框禁用"
    - path: "apps/web/src/i18n/messages.ts"
      provides: "新增 gateway 相关文案 key（平铺格式，双语）"
  key_links:
    - from: "GatewaySelector"
      to: "GET /api/server/gateways"
      via: "fetch on mount + relay gateway.status 帧驱动在线状态"
    - from: "GatewaySelector onSelect"
      to: "chat-panel.tsx setSelectedGatewayId"
      via: "props 回调"
    - from: "selectedGatewayId"
      to: "sendFrame gatewayId"
      via: "已在 Plan 04 注入"
---

<objective>
在 /chats 页面顶部加入 Gateway 选择器组件，从 GET /api/server/gateways 加载列表，显示名称和在线状态，支持多 Gateway 切换，离线或无选择时禁用输入框。

Purpose: 用户可见地选择要操作的 Gateway（D-15/D-16），Plan 04 的 selectedGatewayId 由此组件驱动。
Output: GatewaySelector 组件 + chat-panel 集成
</objective>

<execution_context>
@/Users/dream/code/tether/.planning/phases/14-multi-device-gateway-routing/14-RESEARCH.md
</execution_context>

<context>
@/Users/dream/code/tether/.planning/ROADMAP.md
@/Users/dream/code/tether/apps/web/CLAUDE.md

<interfaces>
<!-- GET /api/server/gateways 响应（Plan 02 实现） -->
{
  code: 0,
  data: Array<{
    gatewayId: string;
    deviceKey?: string;
    hostname?: string;
    name: string;         // 用户可编辑别名，初始为 hostname
    status: 'online' | 'offline' | 'revoked';
    lastSeenAt: number;
  }>
}

<!-- relay gateway.status 帧（现有 RelayServerToClientFrame） -->
{ type: 'gateway.status'; gatewayId: string; status: 'connected' | 'disconnected' }

<!-- chat-panel.tsx 现有 state（Plan 04 引入的） -->
const [selectedGatewayId, setSelectedGatewayId] = React.useState<string | undefined>(undefined);
const [showGatewaySelector, setShowGatewaySelector] = React.useState(false);

<!-- apps/web/src/lib/api.ts — 现有 fetch auth helper（H4 修复：正确函数名）-->
export function gatewayAuthHeaders(token?: string): HeadersInit | undefined {
  // 尽管名称含 "gateway"，此函数实际返回当前用户的 normal access token 的 Authorization 头
  // getStoredNormalAccessToken() 读取 localStorage 中的 normal auth token
  // 在 web 组件中调用 fetch 加认证头时，使用 gatewayAuthHeaders()（无需传参，自动读取存储的 token）
}
-- 注意：不存在 normalAuthHeaders() 函数，必须使用 gatewayAuthHeaders()

<!-- apps/web/src/i18n/messages.ts — i18n 格式（H4 修复）-->
-- 结构: WEB_MESSAGES = { zh: { key: '中文', ... }, en: { key: 'English', ... } }
-- 所有 key 必须平铺在 zh 和 en 对象中，不允许嵌套对象
-- 错误格式: gatewaySelector: { offline: { zh, en } }  ← 禁止嵌套
-- 正确格式: zh: { gatewaySelectorOffline: 'Gateway 已离线', ... }
             en: { gatewaySelectorOffline: 'Gateway offline', ... }

<!-- 组件规范（来自 apps/web/CLAUDE.md） -->
-- 按钮: Button from @tether/design
-- 图标: lucide-react
-- 新文件: kebab-case (gateway-selector.tsx)
-- 文案: 走 src/i18n/messages.ts + useI18n()
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: 创建 GatewaySelector 组件 + 新增 i18n key（平铺格式）</name>
  <files>
    apps/web/src/components/chats/gateway-selector.tsx
    apps/web/src/i18n/messages.ts
  </files>
  <action>
    **先更新 apps/web/src/i18n/messages.ts（H4 修复：平铺 key 格式）：**

    在 `WEB_MESSAGES.zh` 对象中（与其他平铺 key 同级，例如紧跟 `gatewayNotConnected` 之后）新增：
    ```typescript
    gatewaySelectorOffline: 'Gateway 已离线',
    gatewaySelectorSelect: '选择 Gateway',
    gatewaySelectorEmpty: '未找到 Gateway，请先运行 tether gateway login',
    gatewaySelectorNoSelection: '请先选择 Gateway',
    ```

    在 `WEB_MESSAGES.en` 对象中（同样位置新增，保持与 zh 相同 key）：
    ```typescript
    gatewaySelectorOffline: 'Gateway offline',
    gatewaySelectorSelect: 'Select Gateway',
    gatewaySelectorEmpty: 'No Gateway found. Run tether gateway login first.',
    gatewaySelectorNoSelection: 'Select a Gateway first',
    ```

    禁止使用嵌套对象格式（如 `gatewaySelector: { offline: {...} }`），必须与现有所有 key 同级平铺。

    **新建 apps/web/src/components/chats/gateway-selector.tsx：**

    组件接收 props：
    ```typescript
    type GatewayInfo = {
      gatewayId: string;
      name: string;
      hostname?: string;
      status: 'online' | 'offline' | 'revoked';
    };

    type GatewaySelectorProps = {
      selectedGatewayId: string | undefined;
      onSelect: (gatewayId: string) => void;
      // relay gateway.status 更新由 chat-panel 维护，传入在线状态覆盖
      onlineGatewayIds: Set<string>;
    };
    ```

    组件内部逻辑：
    1. `useEffect` on mount：
       ```typescript
       fetch('/api/server/gateways', { headers: gatewayAuthHeaders() })
       ```
       （使用 `gatewayAuthHeaders` from `../../lib/api`，不是 `normalAuthHeaders`，后者不存在）
       加载列表，存入 `gateways` state
    2. 显示名称规则：`gateway.name` 非空用 name，否则用 hostname，否则用 gatewayId 前 8 位
    3. 在线状态：`onlineGatewayIds.has(gateway.gatewayId)` 覆盖 DB 的 status（relay 实时优先）
    4. 当只有 1 个 Gateway 时：只显示名称 + 状态圆点，不显示下拉
    5. 当多个 Gateway 时：显示当前名称，点击弹出简单列表（用绝对定位 dropdown），点击选择
    6. revoked 状态的 Gateway 不显示在列表中（过滤）
    7. 组件使用 `useI18n()` 获取 `t`，文案从 i18n key 读取

    UI 规范：
    - 状态圆点：在线绿色（`text-green-500`），离线灰色（`text-foreground-tertiary`）
    - 当前选中 Gateway 离线时：圆点灰色 + 显示 `t.gatewaySelectorOffline` 文字
    - 无 Gateway 时：显示 `t.gatewaySelectorEmpty`
    - 使用 lucide-react 的 `ChevronDown` 图标（多 Gateway 时才显示）
    - 样式保持与 chat-panel 顶部区域一致（`text-sm`, `px-3`, `py-1.5` 等）
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/web typecheck
    ```
  </verify>
  <done>
    - gateway-selector.tsx 存在，组件可渲染
    - i18n messages 新增 4 个平铺 key（zh 和 en 各一份）（H4 修复）
    - fetch 使用 gatewayAuthHeaders()，不是不存在的 normalAuthHeaders()（H4 修复）
    - typecheck 通过
  </done>
</task>

<task type="auto">
  <name>Task 2: chat-panel.tsx 集成 GatewaySelector + 离线/无选择禁用输入框</name>
  <files>apps/web/src/components/chats/chat-panel.tsx</files>
  <action>
    **1. 新增 onlineGatewayIds state（在 selectedGatewayId 附近）：**
    ```typescript
    const [onlineGatewayIds, setOnlineGatewayIds] = React.useState<Set<string>>(new Set());
    ```

    **2. 在 gateway.status 帧处理（约 lines 525-540）更新 onlineGatewayIds：**
    ```typescript
    if (frame.type === 'gateway.status' && typeof frame.gatewayId === 'string') {
      setHasGatewayStatusFrame(true);
      if (frame.status === 'connected') {
        setOnlineGatewayIds(prev => new Set([...prev, frame.gatewayId]));
        // ... 现有逻辑
      }
      if (frame.status === 'disconnected') {
        setOnlineGatewayIds(prev => {
          const next = new Set(prev);
          next.delete(frame.gatewayId);
          return next;
        });
        // ... 现有逻辑
      }
    }
    ```

    **3. 计算当前选中 Gateway 是否在线：**
    ```typescript
    const selectedGatewayOnline = selectedGatewayId
      ? onlineGatewayIds.has(selectedGatewayId)
      : false;
    ```

    **4. 在 chat-panel 顶部区域（header）加入 GatewaySelector：**
    搜索 chat-panel 顶部渲染区域（通常是 provider/model 选择器所在的 header div），在合适位置加入：
    ```tsx
    <GatewaySelector
      selectedGatewayId={selectedGatewayId}
      onSelect={(id) => {
        setSelectedGatewayId(id);
        setShowGatewaySelector(false);
      }}
      onlineGatewayIds={onlineGatewayIds}
    />
    ```

    **5. 离线时禁用输入框（D-16）+ 无选择时也禁用（M1 修复）：**

    找到 sendMessage 的 disabled 条件（搜索 `isInflight || !wsReady || connectionError`），加入：
    ```
    || !selectedGatewayId                           // 无选择：禁用并提示先选 Gateway
    || (selectedGatewayId && !selectedGatewayOnline) // 离线：禁用并显示离线提示
    ```

    对应地，在输入框 placeholder 或其下方，根据状态显示不同提示（来自 i18n）：
    - `!selectedGatewayId` → 显示 `t.gatewaySelectorNoSelection`（"请先选择 Gateway"）
    - `selectedGatewayId && !selectedGatewayOnline` → 显示 `t.gatewaySelectorOffline`（"Gateway 已离线"）

    **6. 移除 Plan 04 的临时占位提示（showGatewaySelector 文案）：**
    Plan 04 中添加的临时 `{showGatewaySelector && !selectedGatewayId && (...)}` 区块，替换为 GatewaySelector 组件（GatewaySelector 内部已处理无 Gateway 的空状态）。

    **不需要修改的内容：**
    - selectedGatewayId 注入 sendFrame 的逻辑（Plan 04 已完成）
    - gateway_required/gateway_unauthorized 的 error 处理（Plan 04 已完成）
  </action>
  <verify>
    ```bash
    pnpm --filter @tether/web typecheck
    pnpm --filter @tether/web build
    ```
  </verify>
  <done>
    - onlineGatewayIds state 存在，由 gateway.status 帧维护
    - GatewaySelector 组件显示在 chats 页面顶部
    - 无选中 Gateway 时输入框 disabled + 提示 gatewaySelectorNoSelection（M1 修复）
    - 选中 Gateway 离线时输入框 disabled + 提示 gatewaySelectorOffline（D-16）
    - typecheck 和 build 通过
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    - Plan 01: DB migration 009 新增 device_key/hostname/local_port 列，更换 unique key（幂等）
    - Plan 02: 服务端 upsert-by-device-key + deviceKey 格式校验 + GET /api/server/gateways
    - Plan 03: CLI device.json + auth.json 简化 + 4 个 callsite 修复
    - Plan 04: Protocol gatewayId 类型更新（仅新建分支）+ Web sendFrame 注入
    - Plan 05: Relay fallback 移除 + broadcastGatewayStatus 去绑定 + gateway_required/gateway_unauthorized + 隔离测试
    - Plan 06: GatewaySelector 组件 + 离线/无选择禁用
  </what-built>
  <how-to-verify>
    **基础功能验证：**
    1. 运行 `tether gateway login`，确认：
       - 浏览器 URL 包含 `deviceKey=dev_xxx` 参数
       - 登录完成后 `~/.tether/device.json` 存在且含 deviceKey
       - `~/.tether/auth.json` 只有四字段（serverUrl/accessToken/refreshToken/expiresAt）
    2. 打开 /chats 页面，确认：
       - 顶部显示 Gateway 名称和状态圆点
       - Gateway 在线时圆点绿色，输入框可用
       - Gateway 离线时输入框禁用，显示"Gateway 已离线"文字
    3. 发送一条消息（新建会话），确认：
       - 消息正常转发到 Gateway 并收到响应
       - 浏览器 DevTools > Network > WS 帧中新建 client.chat 含 gatewayId 字段
       - 续聊 client.chat 不含 gatewayId 字段（Phase 15 路由）
    4. 若有第二台设备也登录了 Gateway，确认选择器显示多个选项，点击可切换

    **无 Gateway 验证：**
    5. 在没有任何 Gateway 登录的情况下打开 /chats，确认：
       - 输入框禁用，显示"请先选择 Gateway"提示（不是等 Relay 报错才禁用）

    **离线验证（可选）：**
    6. 断开 Gateway 进程，确认：
       - Gateway 状态圆点变灰
       - 输入框禁用
       - 显示离线提示文字
  </how-to-verify>
  <resume-signal>输入 "approved" 确认功能正常，或描述发现的问题</resume-signal>
</task>

</tasks>

<verification>
```bash
pnpm --filter @tether/web typecheck
pnpm --filter @tether/web build
```
</verification>

<success_criteria>
- GatewaySelector 组件从 GET /api/server/gateways 加载并渲染 Gateway 列表
- 在线状态由 relay gateway.status 帧实时更新
- 多 Gateway 时点击可切换 selectedGatewayId
- 无选中 Gateway 时输入框禁用 + 显示"请先选择 Gateway"（M1 修复）
- 离线 Gateway 时输入框禁用 + 显示离线提示（D-16）
- i18n key 以平铺格式写入 WEB_MESSAGES.zh 和 WEB_MESSAGES.en（H4 修复）
- 使用 gatewayAuthHeaders() 而非不存在的 normalAuthHeaders()（H4 修复）
- revoked 状态 Gateway 不在列表中
- 本机自动探测未实现（D-17）
- human verify checkpoint 通过
</success_criteria>

<output>
完成后创建 `.planning/phases/14-multi-device-gateway-routing/14-06-SUMMARY.md`，记录：
- GatewaySelector 文件路径
- onlineGatewayIds 的维护逻辑
- i18n 新增的 key 列表（平铺格式）
- 禁用条件：无选择 + 离线两种情况
- human verify 的结果
</output>
