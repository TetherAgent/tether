# Tether Server - Egg 服务端规范

本文档是 `apps/server` 的服务端协作规范。修改本目录下的路由、控制器、中间件、服务、数据库、Redis、认证或配置时，必须先对照本文档，不得以“临时方案”为由绕过。

## 文档维护规则

**本文档必须与代码保持同步，以下操作完成后必须立即回写本文档：**

| 操作 | 需要更新的章节 |
| --- | --- |
| 新增或调整 `app/controller/` 控制器分组、接口组织方式 | 分层规则、Controller 规则、反模式 |
| 新增、删除或调整 `app/router.ts` / 子路由文件的挂载方式 | 分层规则、Middleware 规则、配置规则、反模式 |
| 新增中间件或修改全局/路由级中间件链路 | Middleware 规则、配置规则、认证与响应、反模式 |
| 新增响应格式、`ctx` 扩展、错误处理或 `ctx.throw` 约定 | Controller 规则、Middleware 规则、认证与响应、反模式 |
| 新增 `app/service/` 领域分组、Service 入口或跨 service 调用方式 | Service 规则、MySQL 规则、Redis 规则、反模式 |
| 新增后台 job、Socket.IO namespace、长连接推送或异步任务模式 | 后台任务与实时通道规范、Service 规则、反模式 |
| 新增类型、常量、纯工具、第三方 SDK 或协议转换层 | 分层规则、类型与工具规则、反模式 |
| 新增数据库访问方式、事务边界、SQL 组织或 schema 初始化规则 | MySQL 规则、配置规则、验证命令 |
| 新增 Redis 使用方式、key 约定或缓存/发布订阅规则 | Redis 规则、配置规则、验证命令 |
| 新增认证、token class、白名单或权限边界 | Middleware 规则、认证与响应、配置规则 |
| 新增配置分组、环境变量、密钥来源或启动脚本约束 | 配置规则、测试与验证规范 |
| 新增测试模式、测试 helper 或最小验证闭环 | 测试与验证规范、反模式 |
| 发现新的服务端反模式 | 反模式 |
| 影响长期架构事实或跨 app 协作方式 | 根目录 `AI_CONTEXT.md` 的 Server API 约定 |

**回写格式要求：**

- 新增规则时，直接补充到对应章节，不得只改代码不改文档。
- 新增反模式时，追加到“反模式”表格，格式固定为：`| 禁止行为 | 原因 | 正确做法 |`。
- 新增目录或分层约束时，必须补全示例路径。
- 修改 `apps/server` 的长期架构事实时，同时更新根目录 `AI_CONTEXT.md`，不要只更新本文档。
- 如果某次改动不需要文档回写，提交说明或最终回复里要明确说明原因。

## 目标与边界

服务端规范的目标不是追求复杂分层，而是保证 `apps/server` 继续演进时保持以下特性：

- 请求入口清晰，路由、权限、参数校验和错误处理位置稳定。
- controller 保持薄层，不把业务编排、SQL、Redis、token、密码校验写进 controller。
- service 按领域收口业务能力，跨接口复用逻辑不回流到 router/controller。
- MySQL、Redis、runtime store、audit、notification、auth 等基础能力有单一入口，后续排查可追踪。
- Web、Admin Web、HTTP package 和 Server 的数据契约稳定，协议变化必须同步验证。
- Socket.IO、后台 job、Gateway 会话、审计事件等副作用入口可追踪，不在随机 helper 中偷偷执行。

## 入口顺序

1. 先读仓库根目录 `AGENTS.md`、`CLAUDE.md`、`PROJECT.md`、`AI_CONTEXT.md`。
2. 再读本文档。
3. 最后读取当前任务涉及的 controller、service、middleware、config 和测试。

## 修改前自检清单

开始改 `apps/server` 前，至少确认以下问题：

1. 这次改动属于哪个服务端领域，为什么放在这个目录或文件？
2. 是否已有能力可复用，例如 `ctx.service.auth`、`ctx.service.authRepository`、`ctx.service.gateway`、`ctx.service.gatewayRepository`、`ctx.service.audit`、`ctx.service.auditRepository`、`ctx.service.db`、`ctx.service.runtime`、`ctx.service.notification`、`ctx.service.redis`、`ctx.service.admin.*`？
3. 是否影响 `router`、controller、middleware、service、repository、runtime、Redis、MySQL、Socket.IO 或配置启动链路？
4. 是否影响登录白名单、token class、路由级权限、CORS、CSRF、`config.keys`、JWT secret、MySQL/Redis 密码等安全边界？
5. 最小验证闭环是什么，需要跑哪些命令，需要新增或更新哪些测试？
6. 是否影响前后端协议、`@tether/http`、Web、Admin Web 的请求/响应处理？
7. 是否影响本地 `env.sh` 或服务器 `/data/env/tether.sh` 的环境变量约定？
8. 是否需要回写本文档或根目录 `AI_CONTEXT.md`？

## 复用优先原则

- 修改服务端前，先判断仓库里是否已经有同类能力，优先复用已有 service、middleware、utils、types、router 分组和 workspace package。
- 不要因为“当前任务只改一点”就重新写一套鉴权、token、响应包装、MySQL 查询、Redis key、审计记录、通知记录或 Gateway 会话逻辑。
- 如果现有实现命名一般、位置不理想，也优先在原能力上小步整理，而不是平行再造 `xxx2`、`newXxx`、`helperXxx`。
- 只有确认现有能力不能覆盖，且扩展会显著扭曲职责时，才允许新增实现；新增前必须说明为什么不能复用。

### 已有能力清单（修改前先查）

| 能力 | 优先复用位置 | 说明 |
| --- | --- | --- |
| 统一响应和错误包装 | `app/extend/context.ts`、`app/middleware/error.ts` | 成功走 `ctx.success(data)`，业务错误走 `ctx.throw(...)` |
| 登录态与 token class 校验 | `app/middleware/verify-login.ts`、`app/middleware/require-token-class.ts` | 全局登录态 + 路由级权限，不在 controller 内重复判断 |
| 普通用户/管理后台/Gateway token | `app/service/auth.ts`、`app/utils/auth-token.ts` | 有 ctx 的业务走 service；无 ctx 的纯签验走 utils |
| 管理后台领域能力 | `app/controller/admin/`、`app/service/admin/`、`app/router/admin.ts` | 管理后台接口优先在 admin 分组扩展 |
| MySQL 基础能力 | `app/service/db.ts` | 只负责 Egg MySQL client、schema 初始化、query、transaction 和存储模式检测，不放业务表方法 |
| Auth 数据访问 | `app/service/authRepository.ts` | account/user/admin_user/device/refresh token/revoked token；内部决定 MySQL / runtime |
| Gateway 数据访问 | `app/service/gatewayRepository.ts` | gateway 表读写和后台管理查询；内部决定 MySQL / runtime |
| Audit 数据访问 | `app/service/auditRepository.ts` | audit_events 表写入、列表、筛选、统计；内部决定 MySQL / runtime |
| Redis 能力 | `app/service/redis.ts` | Redis 读写、key 规则、连接能力统一收口 |
| runtime store | `app/service/runtime.ts` | 内存态只通过 service 访问，测试重置也走 service |
| 审计事件 | `app/service/audit.ts` | 管理动作、token 撤销等副作用需要审计时复用 |
| 通知发送 | `app/service/notification.ts` | 不在业务 service 里临时拼一套通知逻辑 |
| Gateway / session / IO | `app/service/gateway.ts`、`app/io/` | 长连接、session、Socket.IO 相关能力优先复用 |
| 共享 HTTP 契约 | `packages/http`、`apps/web`、`apps/admin-web` | 响应结构或 token header 变化必须同步验证 |

## 技术栈

- 框架：Egg.js + TypeScript
- 包管理：pnpm
- HTTP 成功返回：Controller 统一使用 `ctx.success(data)`；错误返回只允许 `error` middleware 使用 `ctx.error(...)`
- 密码：统一使用 `egg-bcrypt`
- MySQL：通过服务层收口，不在 controller 内直接访问
- Redis：通过 `ctx.service.redis` 收口，不在 controller 内直接访问

## 分层规则

```text
app/router.ts                 路由注册和中间件挂载
app/controller/               只读入参、调 ctx.service、返回 ctx.success(data)
app/middleware/               登录态、错误处理、通用请求链路能力
app/extend/context.ts         ctx.success / ctx.error 等上下文扩展
app/service/                  Egg Service，必须 import { Service } from 'egg'
app/service/admin/            管理后台领域 service
app/io/                       Socket.IO namespace 和握手中间件
app/lib/                      第三方库适配或底层协议封装，不能放业务编排
app/types/                    服务端内部类型
app/utils/                    无 ctx 依赖的纯工具，不能放业务编排
config/                       插件、运行配置、环境变量映射
sql/                          初始化 SQL 和长期 schema
test/                         服务端测试
```

### 分层硬规则

| 层 | 允许做的事 | 禁止 |
| --- | --- | --- |
| `router.ts` / `app/router/*` | 注册路径、HTTP 方法、挂中间件、按领域分组 | 写业务逻辑、读数据库、生成 token |
| `controller` | 取参数、最小归一化、调用 `ctx.service`、返回 `ctx.success(data)` | 拼 SQL、访问 Redis、校验密码、签发 token、写复杂业务分支 |
| `service` | 业务编排、外部依赖调用、数据组装、抛业务错误 | 返回 Koa 原始响应对象、直接依赖前端页面语义、判断 MySQL / runtime 存储模式 |
| repository / SQL | 数据读写、行对象转换、事务边界、存储模式选择 | 混入 HTTP 参数校验和 controller 语义 |
| `middleware` | 通用鉴权、错误处理、请求链路能力 | 承担某个单接口专属业务流程 |
| `io` | Socket.IO namespace、握手认证、packet 中间件 | 直接写 HTTP controller 逻辑 |
| `utils` | 纯函数、纯算法、无 ctx 副作用的 token 签验 | 依赖 `ctx`、直接访问配置、数据库或 Redis |
| `lib` | 第三方协议/SDK 的底层适配 | 编排业务流程或读取 controller 入参 |

### 新增能力放置规则

- 新接口先判断是现有 controller 分组扩展，还是需要新增领域分组；不要把不相关接口继续堆进已有文件。
- 多个接口共享的业务逻辑放对应 service，不在多个 controller 内复制。
- 某领域出现稳定数据访问需求时，优先放到对应领域 service 或 `*Repository` Service，避免 SQL 散落。
- 仅依赖类型、常量、纯计算的逻辑才能进入 `app/utils/`、`app/types/` 或 workspace package。
- 第三方协议适配可以放 `app/lib/`，但业务编排仍必须回到 service。
- 新增目录或新的分层模式时，必须同步补本文档的目录职责和反模式。

## Service 规则

- `app/service/**/*.ts` 必须导出 `class XxxService extends Service`。
- service 文件顶部必须使用 `import { Service } from 'egg'`。
- controller 禁止直接 import service 函数，必须通过 `this.ctx.service.xxx` 调用。
- 业务编排放 service，不放 controller。
- service 文件不导出业务函数；对外业务入口只能是 Service 方法。
- 允许在 service 文件内保留少量未导出的纯函数作为内部实现细节，例如格式化、脱敏、解析。
- Service 方法开头优先写 `const { app, ctx } = this` 或 `const { ctx } = this`，后续通过 `ctx.service`、`app.config` 取依赖。
- 跨 service 调用必须通过 `this.ctx.service` / `ctx.service`，不要从另一个 service 文件 import 业务函数。
- 单个 service 文件只负责一个清晰职责；当文件同时承担认证、数据访问、通知、审计和协议转换时，应拆到已有领域 service 或私有 helper。
- 数据访问方法命名要表达动作，例如 `list*`、`get*`、`create*`、`update*`、`delete*`、`upsert*`、`mark*`、`revoke*`。
- 长事务、大批量迁移、补数据、后台异步处理优先放 service，由 controller/schedule/CLI 触发，不在 controller 内直接执行。
- 只有真正无 ctx 依赖、无业务编排的通用算法才能放 `app/utils/`。

## Controller 规则

- controller 只做四件事：取参数、最小归一化、调用 `ctx.service`、返回 `ctx.success(data)`。
- controller 不直接访问 MySQL、Redis、运行时 store。
- controller 不直接生成密码 hash、不校验密码、不签发 token。
- controller 不写业务 `try/catch`，不直接 `ctx.error()`；业务错误交给 service `ctx.throw(...)`，再由 `app/middleware/error.ts` 统一处理。
- controller 内只允许做轻量参数边界检查；可复用校验放 middleware、service 私有方法或纯工具。

## Router 规则

- HTTP 路由统一从 `app/router.ts` 注册；领域路由可以拆到 `app/router/*.ts`，但必须由主 router 显式挂载。
- 路由按领域分组，路径风格保持 `/api/...`、`/api/admin/...` 等现有层级，不临时发明新前缀。
- 中间件挂载写在路由声明处，权限边界必须从 route 定义即可看出。
- 公开接口只通过 `config.verifyLoginWhitelist` 放行；不要在 router 里跳过全局中间件。
- 新增 admin 路由默认挂 `management_access`；新增普通客户端路由默认挂 `normal_client_access`；新增 Gateway 路由默认挂 `gateway_access`。

## Middleware 规则

- 通用请求链路放 `app/middleware/`。
- `error` 是全局错误中间件，必须放在 `config.middleware` 第一位。
- `verifyLogin` 是全局登录态中间件，必须挂在 `config.middleware`；它根据 `config.verifyLoginWhitelist` 跳过公开路由。
- `requireTokenClass` 是路由级权限中间件，只在 `app/router.ts` / 子路由里按需挂载。
- `app/middleware/` 只放 Egg middleware factory；普通 helper 不放这里，避免被误认为可配置中间件。
- 鉴权失败使用 `ctx.throw(status, msg)`，由 `error.ts` 保持 `{ code, msg, data, stack }` 响应结构。
- 登录白名单统一来自 `config.verifyLoginWhitelist`。
- Koa middleware 已有 `ctx` 时，认证和业务状态查询优先走 `ctx.service`，不要 import service 业务函数。
- Koa middleware 中可用 `ctx.throw(status, msg)` 抛业务错误，由 `error.ts` 统一转响应；不要局部吞掉异常后手写响应。
- Socket.IO 握手这类没有 Koa `ctx` 的代码，只能调用无业务副作用的纯工具；需要业务能力时先进入 service。
- 新增中间件后必须检查 `config/config.default.ts` 的 `middleware` 配置和路由挂载。

## 密码规则

- 注册时统一使用 `ctx.genHash(password)`。
- 登录时统一使用 `ctx.compare(password, passwordHash)`。
- 不允许新增手写 HMAC、MD5、SHA password hash。
- 数据库字段仍使用 `password_hash`，但内容必须是 bcrypt hash。
- 旧的非 bcrypt hash 不能继续复用；需要登录的账号应重置密码。

## MySQL 规则

- MySQL 基础能力由 `app/service/db.ts` 收口，但 `db.ts` 只允许提供连接、schema 初始化、query、transaction，不允许新增业务表方法。
- 业务 SQL 放在对应领域 repository service，例如 `authRepository.ts`、`gatewayRepository.ts`、`auditRepository.ts`；业务 service 不写 SQL、不判断存储模式。
- controller、middleware、router、IO handler 不允许直接访问数据库。
- 禁止恢复全局 `storage.ts` / 万能 DAO；新增数据访问必须先判断归属领域。
- 新增数据库配置时，必须同时确认环境变量、`config/config.default.ts`、启动脚本和部署环境一致。

### 数据访问规则

- controller、middleware、router、IO handler 不允许直接访问 MySQL。
- 默认业务入口是当前领域 service；领域内部通过同领域 repository 访问数据，例如 `ctx.service.authRepository.*`。
- MySQL 连接必须走 Egg MySQL 插件，配置统一在 `config/config.default.ts` 的 `config.mysql.clients`。
- 当前数据源名固定为 `tether`，`db.ts` 通过 `app.mysql.get('tether')` 取连接，领域 repository 通过 `ctx.service.db` 访问。
- 业务 service 不直接调用 `app.mysql.get('tether')`、`ctx.service.db.query()`、`ctx.service.db.transaction()` 或 `ctx.service.db.mysqlModeEnabled()`；需要数据时只调用同领域 repository。
- MySQL / runtime fallback 只能在 repository 内部决定；如果未来确认只保留 MySQL，再统一删除 repository fallback 和 `mysqlModeEnabled()`。
- `app.mysql.get('<datasource>')` 的 datasource 名称必须来自 `config/config.default.ts` 的稳定配置；不能在业务代码里临时拼接连接名。
- SQL 必须使用占位符，不拼接用户输入。
- 表简单、操作单一时优先封装成明确的 repository 方法；涉及 join、聚合、批量 upsert、归档或复杂筛选时，SQL 必须集中在领域 repository 私有方法。
- 多表写入必须有事务边界；事务内统一使用同一个 connection，不要混用外部 pool。
- schema 初始化 SQL 放在 `sql/`。
- 行对象转领域对象的逻辑要集中，避免每个调用点各自 `Number()`、`JSON.parse()`、字段重命名。
- SQL 片段需要复用时，放领域 repository 私有方法、领域 service 私有方法或 `sql/`，不要复制同一段查询。

## Redis 规则

- Redis 能力由 `app/service/redis.ts` 收口。
- 新增 Redis 读写必须通过 `ctx.service.redis`。
- Redis key 命名必须带业务前缀，例如 `auth:*`、`gateway:*`。
- 不在 controller、middleware 里直接使用 `app.redis`。
- Redis value 的序列化、过期时间和 key 前缀必须在 service 内集中定义，不在调用点散落字面量。
- 涉及 token、session、gateway 状态的 Redis 变更必须同时检查撤销、过期和审计语义。

## 类型与工具规则

- Web、Admin Web、Server 共享的请求/响应结构，优先进入 workspace package，例如 `packages/http` 或后续共享 types 包。
- 仅服务端内部使用、且带 Egg 或基础设施细节的类型，放 `app/types/`。
- 禁止在 controller 和 service 间长期依赖 `any` 逃避契约；局部框架兼容可以短期 `as any`，稳定接口必须补类型。
- 无副作用、无 `ctx/app/config/mysql/redis` 依赖的逻辑才进入 `app/utils/`。
- 常量、Redis key、token class、错误码等稳定字面量不要在多个 service 中散落；新增长期常量应集中到合适的 types/utils/config。
- `app/lib/` 只放底层协议或第三方库适配，不放业务状态机。

## 后台任务与实时通道规范

- 后台 job、长事务、补数据、批量清理等较重任务放 service 或专门 job 入口，不在 controller 中内联。
- “接受请求后异步继续执行”的接口必须明确返回语义，不能让前端误以为任务已完成。
- Socket.IO namespace、握手认证和 packet 校验放 `app/io/`；需要业务状态时调用 service。
- 推送逻辑放 service，不直接散落在 controller、middleware 或 IO handler 中。
- 后台任务和实时通道失败至少记录可检索的日志前缀、session/user/account/token class 等必要上下文，敏感信息必须脱敏。
- daemon/Gateway 相关能力默认只面向本机回环或已认证通道，不能绕过配对/认证流程直接暴露。

## 认证与响应

- 普通用户登录：`ctx.service.auth.loginNormalUser`
- 管理员登录：`ctx.service.auth.loginManagementUser`
- 登录态校验：全局 `verifyLogin` 接受 `normal_client_access`、`management_access`、`gateway_access` 并写入 `ctx.state.auth`。
- 权限校验：路由级 `requireTokenClass({ expected: [...] })` 判断当前接口允许的 token class。
- 管理员体系保留独立 `admin_users` 表。
- Token 类别继续区分 `normal_client_*`、`management_*`、`gateway_*`。

### 响应规则

- HTTP 状态默认保持 `200`，业务状态用数字 `code` 区分。
- 成功响应只允许 controller 使用 `ctx.success(data)`，不要手写 `{ code, msg, data }`。
- 错误响应只允许通过 `ctx.throw(status, msg)` 抛出，由 `app/middleware/error.ts` 统一转成 `{ code, msg, data, stack }`。
- Service 中可预期业务错误使用 `ctx.throw(status, msg)`；`error.ts` 读取 `err.status / err.code / err.message / err.stack` 形成统一响应。
- 新增响应字段、错误码或 token header 约定时，必须同步更新 `packages/http`、Web、Admin Web 和本文档。
- controller 不直接调用 `ctx.error()`；`ctx.error(...)` 只作为 `error` middleware 的底层响应出口。

## 配置规则

### 配置组织规则

- 运行配置统一放 `config/config.default.ts`，插件开关统一放 `config/plugin.ts`。
- `config/config.default.ts` 负责稳定默认值、环境变量映射和服务端配置分组；不要在 service/controller 里直接读取散落的 `process.env.*`。
- 新增配置按业务域分组，命名必须表达语义；不要新增含义不清的缩写键。
- 全局中间件只在 `config.middleware` 配置，当前顺序固定为 `['error', 'verifyLogin']`。
- 公开接口必须写进 `config.verifyLoginWhitelist`，不要在 router 里绕过登录态。
- 角色或 token class 权限不要写进全局 `verifyLogin`，统一在 router 里挂 `middleware.requireTokenClass(...)`。
- MySQL、Redis、JWT、Egg `keys`、CORS、CSRF 等配置必须在 `config/config.default.ts` 形成单一来源。
- 本地开发优先读取仓库根目录 `env.sh`。
- 服务器优先读取 `/data/env/tether.sh`。

### 密钥与环境规则

- 密钥、token、数据库密码、Redis 密码和第三方凭证不得硬编码进仓库。
- 新增敏感配置必须走环境变量或部署注入，并在本文档或部署文档里说明来源。
- `config.keys`、JWT secret、MySQL password、Redis password 必须来自环境变量或安全默认注入；生产环境缺失时应尽早失败，不允许静默使用弱默认值。
- 日志、错误响应和审计事件不得输出完整密码、token、cookie、JWT secret、数据库连接串。
- 修改环境变量名时，必须同步检查本地 `env.sh`、服务器 `/data/env/tether.sh`、README/部署文档和启动脚本。

### 白名单与安全规则

- 新增公开路径时，必须同时说明为什么可以进入 `verifyLoginWhitelist`。
- 新增管理后台接口默认需要 `management_access`；新增普通客户端接口默认需要 `normal_client_access`；Gateway 接口默认需要 `gateway_access`。
- 路由级权限必须在 `router.ts` 或子路由声明处可见，不允许藏在 controller 内部。
- 修改 CORS、CSRF、cookie、session、`config.keys` 或 token 校验逻辑时，必须跑登录、鉴权失败、鉴权成功三类验证。

## 测试与验证规范

### 测试位置

```text
apps/server/test/*.test.ts                  服务端行为和 service 测试
apps/server/test/helpers/service-context.ts 轻量 Service ctx mock，仅用于测试
```

### 最小验证闭环

- 路由或 controller 改动：至少覆盖受影响接口的成功响应和关键失败路径。
- service / repository / runtime 改动：至少跑对应 service 测试；没有现成测试时，补最小回归用例。
- 配置、中间件、鉴权链路改动：至少覆盖登录白名单、缺 token、错 token class、正确 token class。
- MySQL / Redis / schema 改动：除 typecheck/test 外，尽量本地启动并验证 `/healthz` 或受影响接口。
- 新增 `apps/server/sql/*.sql` migration 后，必须明确验证幂等性：本地读取根目录 `env.sh`，
  服务器读取 `/data/env/tether.sh`；验证命令不得打印数据库密码、JWT secret、Relay secret
  或完整连接串。`ADD COLUMN` 类变更优先使用 `INFORMATION_SCHEMA` 条件迁移，不依赖
  `db.ts` 的 `ADD INDEX` 重复错误兜底。
- 认证、响应协议、错误结构改动：同步验证 `@tether/http`、`@tether/web`、`@tether/admin-web` 是否仍能解析。
- bugfix 可行时先补复现测试，再修复。
- 如果测试命令因既有无关失败无法整体通过，最终说明必须写清失败命令、失败原因、与本次改动的关系。

### 测试编写规则

- 优先验证行为，不测试实现细节。
- controller 测试关注响应体、业务 `code`、关键权限边界，不复刻 service 内部流程。
- service 测试关注输入输出、副作用、审计记录、通知记录、token 撤销、runtime/store 变化。
- repository 测试关注查询语义、过滤条件、排序、幂等写入和事务边界，不只断言“有返回值”。
- 测试不得 import service 文件里的业务函数；业务入口必须走 `ctx.service.xxx` 或测试 helper 创建的 Service 实例。
- runtime 状态重置统一走 `ctx.service.runtime.resetRuntimeStore()`，不要直接 import 内部 store。
- 测试 helper 只能模拟 Egg 上下文，不得成为生产代码依赖。

## 验证命令

```bash
pnpm --filter @tether/server typecheck
pnpm --filter @tether/server test
pnpm start:server
curl -s http://127.0.0.1:4800/healthz
```

改动涉及 Web / Admin Web 请求协议时，同时运行：

```bash
pnpm --filter @tether/http typecheck
pnpm --filter @tether/web typecheck
pnpm --filter @tether/admin-web typecheck
```

## 反模式

| 禁止行为 | 原因 | 正确做法 |
| --- | --- | --- |
| controller 直接 import service 函数 | 绕过 Egg service 生命周期和 `ctx` 能力 | 使用 `this.ctx.service.xxx` |
| controller 包业务 `try/catch` 后 `ctx.error()` | 错误协议分散，每个接口都要维护一套映射 | Controller 成功 `ctx.success(data)`，Service `ctx.throw(...)`，error middleware 兜底 |
| 在 `router.ts` 里写业务逻辑或拼参数 | 路由层职责失真，权限和业务混在一起难审计 | router 只注册路径和中间件，业务下沉 controller/service |
| `verifyLogin` 只在个别 router 里手动挂 | 容易漏保护接口，白名单也失去意义 | 在 `config.middleware` 全局挂载，公开路由写 whitelist |
| 把普通 helper 放进 `app/middleware/` | Egg 会把 middleware 目录视作中间件能力，命名和使用容易混乱 | helper 放 service 内部或 `app/utils/`，middleware 目录只放 factory |
| service 导出 `export async function xxx` 再由 class 包一层 | 形成双入口，绕开 Egg 约定，测试和运行时依赖不一致 | 业务逻辑直接写进 Service 方法，内部 helper 不导出 |
| service 之间互相 import 业务函数 | 破坏 Egg Service 依赖注入和上下文能力 | 使用 `const { ctx } = this; ctx.service.xxx.yyy()` |
| 已有 auth/authRepository/gatewayRepository/auditRepository/runtime/redis 能力却另起一套实现 | 平行能力会快速失控，后续不知道该维护哪套 | 先扩展现有 service，再补文档 |
| 业务 service 里 `if (ctx.service.db.mysqlModeEnabled())` 分叉 | 业务编排层被存储模式污染，MySQL/runtime 两套逻辑会漂移 | 把分叉下沉到领域 repository，service 只调用 repository |
| 手写密码 hash | 与 `egg-bcrypt` 不兼容，线上重置和校验容易混乱 | 注册用 `ctx.genHash`，登录用 `ctx.compare` |
| controller 直接访问 MySQL / Redis | 分层失控，后续审计和测试困难 | 放进对应 service |
| 在 `app/utils/` 写依赖 `ctx` 或配置的函数 | 工具层边界被打穿，运行和测试上下文不一致 | 依赖 `ctx/app` 的逻辑留在 service 或 extend |
| 在 `app/lib/` 写业务编排 | lib 变成第二套 service，绕过 Egg 生命周期 | lib 只做协议适配，业务回到 service |
| Socket.IO / 后台任务里直接复制业务逻辑 | HTTP、IO、后台链路规则分叉 | IO/job 只做入口和校验，调用 service |
| 新增接口手写响应结构 | 前后端协议不一致 | 成功用 `ctx.success(data)`，错误用 `ctx.throw(...)` 交给 error middleware |
| 新增共享响应字段但不更新类型和文档 | 前后端契约漂移 | 同步更新 types/package、本文档和前端请求处理 |
| 服务器启动不走 env 文件 | 配置来源不稳定 | 本地 `env.sh`，服务器 `/data/env/tether.sh` |
| 修改服务端逻辑但不补测试或不跑受影响测试 | 回归只能靠手工和线上发现，鉴权、token、存储尤其容易静默错 | 同步补/更新测试，并跑通最小验证闭环 |
| 测试直接 import service 业务函数 | 绕过 Egg Service 入口，测试路径和生产路径不一致 | 通过 `ctx.service` 或 Service 测试 helper 调用 |
| 新增公开接口不写白名单理由 | 安全边界不可审计，后续无法判断是否误放行 | 更新 `verifyLoginWhitelist` 时同步写清业务理由 |
| 新增敏感配置但只改代码不改 env 文档 | 本地、服务器、CI 配置漂移，部署后才爆错 | 同步更新配置规则、启动脚本和部署说明 |
| 修改鉴权/响应协议但不验证前端请求库 | 前端可能仍按旧 token/header/code 协议处理 | 同时验证 `@tether/http`、Web、Admin Web |
| 改长期服务端约定但不回写本文档 | 规则只存在聊天里，下次继续重复犯错 | 按“文档维护规则”立即更新对应章节 |

## 官方依据

- Egg 官方目录结构把 `app/service/**` 定义为业务逻辑层，Controller 通过 `ctx.service` 访问 Service。
- Egg Service 官方文档要求 Service 类继承 `egg.Service`，Service 可使用 `this.ctx`、`this.app`、`this.service`、`this.config`。
- 本项目因此采用 Egg 原生 Service 入口，不再新增“导出业务函数 + Service 包装”的双入口写法。
- Egg Service 官方文档说明 Service 用于封装复杂业务逻辑、保持 Controller 简洁、支持多级目录，并可通过 `ctx.service.biz.user` 访问。
- Egg MySQL 官方文档建议数据库访问代码放在 Service 层；多数据源配置放 `config.mysql.clients`，通过 `app.mysql.get('clientId')` 获取。
- Egg 启动自定义适合动态配置中心、缓存预加载等启动逻辑；本项目数据库连接信息已在 `config/config.default.ts` 声明，不使用 `app.ts beforeStart` 动态灌 MySQL 配置。
