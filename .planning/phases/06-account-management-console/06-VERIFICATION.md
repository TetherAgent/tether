---
phase: 06-account-management-console
verified: 2026-05-03T04:56:05Z
status: human_needed
score: 7/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/8
  gaps_closed:
    - "SC-2: apps/admin-web/src/pages/AdminRegisterPage.tsx 创建，/admin/register 路由在 AdminLayout 外独立注册，admin-api.ts 添加 createAdmin()"
    - "SC-3: admin-auth-context.tsx 添加 decodeJwtPayload()，loginManagement 现在解析 JWT payload 填充 identity.adminUserId"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "super_admin 可管理管理用户和系统设置；admin 只能管理普通用户、设备、Gateway 和审计，不能管理管理用户"
    addressed_in: "后续版本（不在 Phase 6 范围内）"
    evidence: "CONTEXT.md D-13/D-14 明确规定：v0.3 使用单一管理访问级别，登录即全权，角色权限 UI 差异化推后。ROADMAP Phase 6 Deferred 节也列出了 super_admin vs admin UI 差异化。"
human_verification:
  - test: "访问 /admin/devices，确认表格有「最后在线时间」和「通知 WebSocket 状态」列"
    expected: "SC-5 要求展示设备在线状态、通知 WS 状态和最后在线时间；lastSeenAt 在代码中始终为 null（devices 表无 last_seen_at 列），通知 WS 状态列不存在（D-17 已决定不展示）"
    why_human: "lastSeenAt=null 是否满足 SC-5「最后在线时间」取决于产品决策；通知 WS 状态是否在范围内需人工确认（D-17 已推迟但 SC-5 列出）"
  - test: "检查管理控制台是否满足 SC-5「revoke status reflected in token/session behavior」"
    expected: "设备被吊销后，该设备的现有 WS 连接应被关闭或降权；现有实现只撤销 refresh_tokens（CR-02 指出 gateway_refresh_tokens 未被撤销），无法关闭已有 WS 连接"
    why_human: "需要人工决策 CR-02（gateway_refresh_tokens 未撤销）是否阻止 SC-5 通过"
---

# Phase 6: Account Management Console 验证报告（重新验证）

**Phase Goal:** Provide the first shadcn-based account management Web UI for operating the Phase 5 auth model without hand-editing data or relying on CLI-only administration
**Verified:** 2026-05-03T04:56:05Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure（06-06 修复了 BLOCKER 1 和 BLOCKER 2）

## Goal Achievement

### Observable Truths（源自 ROADMAP Success Criteria）

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | 管理控制台在 `apps/admin-web` 内使用 shadcn 组件和一致的布局基础 | ✓ VERIFIED | 无退化；AdminLayout、5个页面、shadcn 组件均完整保留 |
| 2 | 管理控制台有独立的登录和注册流程；首位注册管理用户为 super_admin，后续为 admin | ✓ VERIFIED (限定) | `AdminRegisterPage.tsx` 存在（114 行，非 stub），`/admin/register` 路由在 AdminLayout 外独立注册（main.tsx 第 23 行）；`createAdmin()` 调用 `POST /admin/api/admins`；服务端 `registerManagementUser` 自动分配 super_admin（第一个）/admin（后续）角色。注意：第一个管理员需通过 `apps/web` 的 `/admin/register` 或 CLI 完成注册——`apps/admin-web` 的注册页面需要已登录 management token，仅供后续管理员注册。SC-2 的"独立注册流程"形式上满足，但第一位 super_admin 的 self-bootstrap 路径仍通过 apps/web 完成。 |
| 3 | 已登录管理用户可查看当前账户/工作区上下文和管理权限 | ✓ VERIFIED (部分) | `decodeJwtPayload()` 已实现（admin-auth-context.tsx 第 3-15 行），`loginManagement` 现在正确填充 `identity.adminUserId`（第 87-102 行）。AdminLayout header 现在显示真实 UUID（非空字符串）。但 header 显示 `adminUserId`（UUID）而非 `email`，因为 JWT payload 不含 email 字段（managementTokenPayload 只包含 adminUserId/accountId/workspaceId/deviceId）。"管理权限"未在 UI 中显示（无角色指示器），但 CONTEXT.md D-14 明确推迟了角色展示。 |
| 4 | super_admin 可管理管理用户和系统设置；admin 只能管理普通用户、设备、Gateway 和审计 | ✓ DEFERRED | CONTEXT.md D-13/D-14 明确规定 v0.3 单一管理访问级别，角色权限 UI 差异化推迟。此项已移至 deferred 列表，不计为 FAIL。 |
| 5 | 授权管理用户可查看用户设备、类型、在线/离线状态、通知 WS 状态、最后在线时间，并吊销设备 | ? UNCERTAIN | 设备列表和吊销 Dialog 已实现（DevicesPage）；但 lastSeenAt 始终为 null（devices 表无 last_seen_at 列），通知 WS 状态列不存在（D-17 决定不展示）。需人工确认接受程度。 |
| 6 | 授权管理用户可查看注册 Gateway、最后在线/认证状态，并取消链接 | ✓ VERIFIED | 无退化；GatewaysPage 完整实现 |
| 7 | 授权管理用户可按 account/workspace/user/device/Gateway/session/action 筛选审计事件，不暴露 token 或密钥 | ✓ VERIFIED | 无退化；AuditPage 筛选 + maskSensitivePayload |
| 8 | 授权管理用户可查看每用户的登录分析：成功登录次数、失败次数、最后登录时间、活跃/已吊销设备数、近期安全事件 | ✓ VERIFIED | 无退化；UsersPage 7列 + 统计数据 |

**Score:** 7/8 truths verified（1 项 DEFERRED 不计为 FAIL，1 项 UNCERTAIN 需人工确认）

### Deferred Items

SC-4 明确按 CONTEXT.md D-13/D-14 推迟，不视为 gap。

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | super_admin vs admin 角色权限 UI 差异化 | 后续版本 | CONTEXT.md D-13: "v0.3 uses a single management access level"；D-14: "Role-based UI differentiation is deferred" |

### 06-06 Gap Closure 验证

#### BLOCKER 1 (SC-2)：管理员注册页

| 验证项 | 状态 | 详情 |
|--------|------|------|
| `apps/admin-web/src/pages/AdminRegisterPage.tsx` 存在 | ✓ VERIFIED | 文件存在，114 行，非 stub |
| 导出 `AdminRegisterPage` 组件 | ✓ VERIFIED | 第 24 行：`export function AdminRegisterPage()` |
| 表单含 email/password/confirmPassword 字段 | ✓ VERIFIED | 三个 FormField + zod refine 密码一致性校验 |
| `createAdmin()` 被调用 | ✓ VERIFIED | 第 11 行 import，第 41 行 `await createAdmin(managementAuth.accessToken, ...)` |
| Link 指向 `/admin/login` | ✓ VERIFIED | 第 107 行：`<Link to="/admin/login">已有账户？登录</Link>` |
| `admin-api.ts` 有 `export async function createAdmin` | ✓ VERIFIED | 第 120-139 行，调用 `POST /admin/api/admins`，body 含 `deviceName: 'admin-web'`/`platform: 'web'` |
| main.tsx `/admin/register` 路由在 AdminLayout 外 | ✓ VERIFIED | 第 23 行（AdminLayout 在第 25 行），顺序正确 |

**注意（非 BLOCKER）：** `AdminRegisterPage` 调用的 `POST /admin/api/admins` 需要已登录 management token。第一位管理员无法通过 `apps/admin-web` 的注册页完成 self-bootstrap——仍需通过 `apps/web` 的 `POST /api/admin/auth/register`（无认证端点）或直接 API 调用。这是设计约束，服务端无认证注册端点 `/api/admin/auth/register` 存在并可用。SC-2 的"独立注册流程"形式上已满足。

#### BLOCKER 2 (SC-3)：登录后身份信息填充

| 验证项 | 状态 | 详情 |
|--------|------|------|
| `decodeJwtPayload()` 函数存在 | ✓ VERIFIED | 第 3-15 行，完整实现 |
| `atob()` base64url 解码 | ✓ VERIFIED | 第 9-10 行：`replace(/-/g, '+').replace(/_/g, '/')` + `atob(base64)` |
| `loginManagement` 中填充 `identity` | ✓ VERIFIED | 第 87-102 行，从 `jwtPayload.adminUserId` 构建 `ManagementIdentity` 对象 |
| JWT payload 包含 `adminUserId` | ✓ VERIFIED | 服务端 `managementTokenPayload()` 包含 `adminUserId: user.id`（auth.ts 第 260 行） |
| header 显示非空标识符 | ✓ VERIFIED | AdminLayout 第 23 行 `managementAuth.identity?.adminUserId ?? ''` 现在返回真实 UUID |
| 解析失败时登录仍正常 | ✓ VERIFIED | try/catch 保护，失败时 `identity = undefined`，login 流程继续 |

**观察：** JWT payload 不含 `email` 字段（`managementTokenPayload` 只有 adminUserId/accountId/workspaceId/deviceId），故 header 显示 UUID 而非 email。AdminLayout 未修改显示逻辑（SUMMARY 记录为有意不修改）。显示 UUID 而非 email 是功能性的但用户体验次优，不视为 BLOCKER。

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `apps/admin-web/src/pages/AdminRegisterPage.tsx` | 管理员注册页（新增） | ✓ VERIFIED | 114 行，react-hook-form + zod，createAdmin 调用 |
| `apps/admin-web/src/lib/admin-api.ts` | createAdmin 函数（新增） | ✓ VERIFIED | 第 120-139 行，POST /admin/api/admins |
| `apps/admin-web/src/main.tsx` | /admin/register 路由 | ✓ VERIFIED | 第 23 行，在 AdminLayout 外 |
| `apps/admin-web/src/contexts/admin-auth-context.tsx` | decodeJwtPayload + identity 填充 | ✓ VERIFIED | 第 3-15 行 + 第 87-102 行 |
| `apps/admin-web/src/pages/DashboardPage.tsx` | 无退化 | ✓ VERIFIED | 文件存在 |
| `apps/admin-web/src/pages/UsersPage.tsx` | 无退化 | ✓ VERIFIED | 文件存在 |
| `apps/admin-web/src/pages/DevicesPage.tsx` | 无退化 | ✓ VERIFIED | 文件存在 |
| `apps/admin-web/src/pages/GatewaysPage.tsx` | 无退化 | ✓ VERIFIED | 文件存在 |
| `apps/admin-web/src/pages/AuditPage.tsx` | 无退化 | ✓ VERIFIED | 文件存在 |

### Key Link Verification（06-06 新增连线）

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| main.tsx | AdminRegisterPage | `Route path="/admin/register"` 第 23 行 | ✓ WIRED | 在 `<Route element={<AdminLayout />}>` 第 25 行之前独立注册 |
| AdminRegisterPage.tsx | admin-api.createAdmin | import 第 11 行 + onSubmit 第 41 行 | ✓ WIRED | 调用 `await createAdmin(managementAuth.accessToken, {...})` |
| createAdmin() | POST /admin/api/admins | requestJson 调用 | ✓ WIRED | 第 125-138 行，method POST，body 含 deviceName/platform |
| loginManagement | ManagementIdentity | decodeJwtPayload(body.accessToken).adminUserId | ✓ WIRED | 第 87-102 行，record 中含 identity 字段 |
| AdminLayout header | managementAuth.identity.adminUserId | useAdminAuth() hook | ✓ WIRED | 现在返回真实 UUID 而非空字符串 |

### Behavioral Spot-Checks

Step 7b: SKIPPED — apps/admin-web 是 React SPA，需要运行中的 dev server。

### Requirements Coverage

REQUIREMENTS.md Traceability 表将 RETAIN-01 映射到 Phase 6（而非 WEBUI-01/MGMT-01~06，这些 ID 在 REQUIREMENTS.md 中无定义）。此问题在初始验证时已记录，06-06 未改变此情况。

| Requirement | Source Plan | Status | Notes |
|-------------|------------|--------|-------|
| WEBUI-01 | 06-01, 06-04, 06-05, 06-06 | ? UNDEFINED IN REQUIREMENTS.md | ROADMAP 引用但 REQUIREMENTS.md 无此 ID |
| MGMT-01 | 06-01, 06-02, 06-04, 06-06 | ✓ SATISFIED | 用户列表 + 管理用户 CRUD（列表/创建/删除）均已实现 |
| MGMT-02 | 06-02, 06-04 | ✓ SATISFIED | 无退化 |
| MGMT-03 | 06-03, 06-05 | ? PARTIAL | 无退化；SC-5 UNCERTAIN 仍待人工确认 |
| MGMT-04 | 06-03, 06-05 | ✓ SATISFIED | 无退化 |
| MGMT-05 | 06-03, 06-05 | ✓ SATISFIED | 无退化 |
| MGMT-06 | 06-04 | ✓ SATISFIED | 无退化 |

### Anti-Patterns（06-06 新增代码扫描）

| File | Line | Pattern | Severity | Impact |
|------|------|---------|---------|--------|
| admin-auth-context.tsx | 72 | 登录 endpoint 为 `/api/admin/auth/login`，与 admin-api.ts 其他端点前缀 `/admin/api/` 不一致 | ℹ️ Info | 登录功能正常；两个端点服务于不同路由器（router.ts vs router/admin.ts） |
| AdminRegisterPage.tsx | 36-38 | 注册需要已登录 managementAuth，第一个管理员无法使用此页 | ⚠️ Warning | 第一位 super_admin 必须通过 apps/web 或 CLI；注册流程不完全自包含在 apps/admin-web |

### Human Verification Required

#### 1. 设备页「最后在线时间」和「通知 WebSocket 状态」是否满足 SC-5

**Test:** 启动 dev server，打开 /admin/devices
**Expected:** SC-5 要求「通知 WebSocket 状态」和「最后在线时间」字段
**Why human:** `lastSeenAt` 在代码中始终为 null（devices 表无 last_seen_at 列），DevicesPage 渲染了「最后在线时间」列（显示 —），但「通知 WS 状态」列不存在。D-17 决定不展示通知 WS 状态，但 SC-5 明确列出此项。需要产品决策：D-17 决策是否覆盖 SC-5 的 WS 状态要求。

#### 2. 设备吊销是否满足「revoke status reflected in token/session behavior」

**Test:** 吊销一个活跃设备，使用该设备的 refresh token 尝试刷新
**Expected:** 已吊销设备的所有 token 均无效
**Why human:** REVIEW CR-02 指出 `gateway_refresh_tokens` 未被 `revokeRefreshTokensByDeviceId` 撤销（只撤销 `refresh_tokens`）。SC-5 要求「revoke status reflected in token/session behavior」，需要人工验证这个遗漏是否阻止 SC-5 通过。

### Gaps Summary

**所有三个 BLOCKER 已处理：**

- BLOCKER 1 (SC-2)：AdminRegisterPage 已创建，路由已接入，createAdmin API 已实现。**CLOSED。**
- BLOCKER 2 (SC-3)：decodeJwtPayload 已实现，identity 现在在 loginManagement 中正确填充。**CLOSED。**
- BLOCKER 3 (SC-4)：按 CONTEXT.md D-13/D-14 意图推迟，不视为 gap。**DEFERRED。**

**当前阻断状态：** 无代码级 BLOCKER。两个 UNCERTAIN 项需人工决策（SC-5 的 WS 状态列和 gateway_refresh_tokens 吊销行为）。

---

_Verified: 2026-05-03T04:56:05Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — closes 06-06 gap closure_
