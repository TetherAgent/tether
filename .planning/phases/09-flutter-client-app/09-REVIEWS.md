---
phase: 9
reviewers: [codex]
reviewed_at: 2026-05-08T00:00:00Z
plans_reviewed: [09-01-PLAN.md, 09-02-PLAN.md, 09-03-PLAN.md, 09-04-PLAN.md, 09-05-PLAN.md, 09-06-PLAN.md]
model: gpt-5.5
---

# Cross-AI Plan Review — Phase 9

## Codex Review

## 总体结论

这 6 份计划的工程拆分、测试意识和"Flutter 独立于 pnpm workspace"的边界都不错，但整体已经明显落后于 **2026-05-08 的 Phase 9 最新决策**：当前 `09-CONTEXT.md` 已把 Phase 9 改成 **Relay only、主视图 Chat、Bottom Tab Bar、KeyboardToolbar 延后、LAN 移除**；而这些计划仍大量实现 LAN、Settings 连接模式、Terminal-first、KeyboardToolbar。另一个硬问题是协议契约：当前 `packages/protocol/src/index.ts` 已是 **8 个 client frame + 8 个 server frame**，包含 `client.chat` 和 `replay.output`，计划仍按 7+7 或 14 变体写，会直接造成 Dart 类型、RelayClient、ReplayScreen 与真实协议不兼容。

整体风险：**HIGH**。建议先做一次 Plan Convergence，不要直接执行这批计划。

## Plan 01 Review

**Summary**
Plan 01 的骨架、i18n、主题、协议类型、codegen exit ramp 方向是对的，但协议类型和项目初始化存在硬漂移。它把 Dart 协议写死为 7+7，并且遗漏 `RelayAuthScope`、`agentSessionId`、`client.chat`、`replay.output`、`ticket/scope` 等当前源码字段，后续所有服务层会建立在错误契约上。

**Strengths**

- 明确把 `native/flutter/` 放在 pnpm workspace 之外，符合 native 目录规则。
- 有 `flutter analyze`、`flutter test`、`flutter build apk --debug` 和 `pnpm typecheck` 验证闭环。
- `gen-dart.sh` 作为未来 codegen exit ramp 是合理的。
- i18n 和 ThemeData 在 Wave 1 先落地，能减少后续屏幕散落硬编码。

**Concerns**

- **HIGH**: 当前协议源码是 8+8，不是 7+7；计划漏 `client.chat`、`replay.output`。
- **HIGH**: `RelayClientToServerFrame.client.auth` 当前支持 `token`、`ticket`、`scope`、`secret`，计划只建 `token/secret`，会影响 authenticated Relay / ticket 语义。
- **HIGH**: `RelaySession` 当前有 `agentSessionId?`，`transport` 是 union，不应只用自由字符串且漏字段。
- **MEDIUM**: `RelaySessionStatus.fromString` 未知值 fallback 到 `lost`，会隐藏协议漂移；未知 enum 应抛 `FormatException`，至少测试覆盖。
- **MEDIUM**: `main.dart` 使用命名路由纯堆栈，不符合最新 Bottom Tab Bar 主壳决策。
- **MEDIUM**: `intl: ^0.19.0` 可能与 Flutter SDK bundled `flutter_localizations` 版本约束冲突，需要以 OHOS Flutter fork 实测为准。
- **LOW**: "ARB 覆盖 UI-SPEC/PATTERNS 所有文案"作为验收过宽，容易和后续屏幕实际文案漂移。

**Suggestions**

- 先从 `packages/protocol/src/index.ts` 重新生成/手写 Dart 类型，按 8+8 覆盖。
- 把协议测试改成"逐 variant round-trip + unknown enum/type throws"，不要只测少数 happy path。
- Plan 01 应只放 app shell、theme、i18n、protocol；不要过早锁定旧路由结构。
- `gen-dart.sh` 至少输出当前手写 bridge 的覆盖清单，方便协议变化时 CI 检查。

**Risk Assessment**
**HIGH**。协议契约错了，后续 Plan 02/05 会整体错位。

---

## Plan 02 Review

**Summary**
AuthService + RelayClient 的方向合理，测试点也比普通计划扎实，但实现细节仍按旧协议和旧视图设计。尤其 RelayClient 没处理 `replay.output`，没有 `client.chat` 能力，connect URL 构造也可能把 `wss://host/client` 错拼成重复 `/client/client`。

**Strengths**

- token 使用 `flutter_secure_storage`，不写 SharedPreferences，安全方向正确。
- 有 silent refresh、Dio 注入、backoff、latestEventId 服务层存储这些关键测试点。
- Relay 状态机按 Web 端行为参考做镜像，方向正确。
- `gateway_unavailable` 单独状态符合 Web 空态。

**Concerns**

- **HIGH**: 不处理 `replay.output` frame。当前协议把回放输出拆成独立 server frame，不能只靠 `event`。
- **HIGH**: 没有 `client.chat` 发送能力，和最新"主视图 Chat"目标冲突。
- **HIGH**: `RelayServerToClientFrame.fromJson` 若 Plan 01 未覆盖 8+8，RelayClient 天然不兼容当前 Relay。
- **HIGH**: `AuthService._tryRefresh()` 若复用带 `TokenRefreshInterceptor` 的 `_dio`，401 refresh 请求本身可能触发拦截器递归或错误重试，需要跳过 refresh endpoint 的 interceptor 逻辑。
- **MEDIUM**: `_buildRelayUri` 无条件 append `/client`，若 server 返回已是 `wss://.../client` 会错。
- **MEDIUM**: `_sendFrame` 在 WS 未 open 时静默丢 subscribe/input/resize，断线重连后只保存 `_subscribedSessionId` 但未实际重订阅。
- **MEDIUM**: `ClientAuthFailed` 后 `_ws.close()` 会触发 reconnect，认证失败可能进入无限重连。
- **LOW**: `key_links.pattern: FlayFlutterSecureStorage` 是拼写错误，验收链接无效。

**Suggestions**

- RelayClient 加 `sendChat(sessionId, message)`，并暴露 Chat surface 所需 stream/state。
- 明确 `replay.output` 与 `event` 的处理路径：Terminal/Replay 都要消费。
- `_buildRelayUri` 支持 server 返回 base URL 或完整 client WS URL，写单测覆盖。
- auth refresh 使用单独 Dio 或 interceptor skip flag，避免 refresh 请求被 401 interceptor 嵌套处理。
- 认证失败、token revoke、logout 后应停止重连并清理状态。

**Risk Assessment**
**HIGH**。核心状态机方向对，但协议和最新产品目标不匹配。

---

## Plan 03 Review

**Summary**
Plan 03 是最大范围错误之一：它实现 LAN direct，但最新 Phase 9 决策已经明确 **D-25 Relay only，D-26/D-27 removed**。从当前目标看，这一整份计划应删除或延期，不应该进入 Wave 2。

**Strengths**

- 如果 LAN 仍在范围内，WS ticket 而不是 access token query 的设计是安全的。
- 3s polling、stop HTTP endpoint、ticket URL 编码都有基本覆盖。
- 明确不接受无效 TLS 证书，安全态度正确。

**Concerns**

- **HIGH**: 与最新 D-25 冲突，本期 LAN 直连不做。
- **HIGH**: Plan 04 依赖 LanClient 做连接模式切换，会把已移除的产品面重新带回来。
- **MEDIUM**: `fetchSessions` 同时 GET `/api/sessions` 和 `/api/sessions?all=1`，但第一份结果变量 `all` 未使用，可能是实现噪音。
- **MEDIUM**: LAN direct 涉及 Gateway 暴露到 LAN 的安全边界，当前 Phase 9 不应新增这条风险面。
- **LOW**: `requirements: [D-25, D-26, D-27]` 与正文解释相反，说明计划生成时未吸收最新决策。

**Suggestions**

- 直接把 Plan 03 改成 "ChatClient / ConversationService" 或 "Relay Chat Surface support"，承接 `client.chat` 和 ChatSessionSurface。
- LAN direct 移到 deferred/backlog，并保留安全研究，不落代码。
- Roadmap 若仍写 SC-3 LAN direct，应先更新 roadmap 或在 Phase 9 CONTEXT 里声明 success criteria 已被 supersede。

**Risk Assessment**
**HIGH**。执行它会实现已移除范围，增加返工和安全面。

---

## Plan 04 Review

**Summary**
登录、注册、SessionList、卡片和 stats 的规划比较完整，但仍基于旧"Settings 切 Relay/LAN + 纯堆栈路由"的产品形态。最新要求是 Bottom Tab Bar，Settings 作为底部 Tab，且无 LAN 连接模式。本计划还没有主会话 Chat 入口设计。

**Strengths**

- Login/Register 的加载、错误、密码遮蔽、成功导航都有明确行为。
- SessionCard 的 `title || provider`、状态、历史/活跃分区、gateway_unavailable 空态都贴近 Web。
- 语言和主题切换纳入 AppBar，符合 i18n/theme 要求。
- Widget 测试覆盖基本标题 fallback 和 swipe 行为。

**Concerns**

- **HIGH**: SettingsScreen 的 Relay/LAN 切换和 Gateway URL 输入已被最新 D-25/D-26 移除。
- **HIGH**: 缺 Bottom Tab Bar 主 Shell；`/sessions`、`/settings` 纯堆栈不符合 D-19/D-20。
- **HIGH**: Session tap 直接进 TerminalScreen，不符合"Chat 默认、Terminal 次级 toggle/tab"。
- **MEDIUM**: `AuthService`、`RelayClient`、`LanClient` Provider 注入不在 Plan 01 main.dart 中完整体现，测试 stub 可能掩盖运行时 provider 缺失。
- **MEDIUM**: RegisterScreen 的"密码不一致"硬编码中文，违反所有可见文案 i18n。
- **MEDIUM**: Swipe stop 无确认可以接受用户决策，但需要考虑误触后的 undo/toast 或至少明确与 Web confirm-stop 差异。
- **LOW**: `DateFormat` 未绑定 locale，时间展示可能中英不一致。

**Suggestions**

- 把 Plan 04 重构为 `MainShell` + BottomNavigationBar：Sessions tab、Settings tab。
- SessionCard 点击进入 `SessionScreen`，内部默认 Chat tab，Terminal 为 secondary tab/toggle。
- 删除连接模式设置，Settings 只保留语言/主题/账号/logout 等本期必要项。
- 所有错误、验证、状态文案补 ARB，不允许中文硬编码。
- SessionList 测试增加 gateway_unavailable 空态、stats row、history tap -> replay、active tap -> session chat 默认入口。

**Risk Assessment**
**HIGH**。UI 方向和导航模型与最新决策冲突，执行后会返工。

---

## Plan 05 Review

**Summary**
Plan 05 的 xterm、resize、observe/control、replay 设计有价值，但它把已延期的 KeyboardToolbar 当成 must-have，并且完全缺失 Chat primary surface。按最新 Phase 9，这份计划应该降级为"Terminal secondary view"，并删掉 KeyboardToolbar 实现。

**Strengths**

- xterm `TerminalView`、`autofocus`、`onResize`、base64 PTY 输出处理、StreamSubscription cleanup 都是必要细节。
- observe 模式双层防护不发送 input，是正确安全边界。
- ReplayScreen readOnly、after:0 的方向正确。
- Ctrl/Esc/Tab 如果未来做，状态机和测试设计相对清晰。

**Concerns**

- **HIGH**: KeyboardToolbar D-12/D-13 已明确 deferred，本计划仍作为核心交付。
- **HIGH**: 缺 ChatSessionSurface Flutter 复刻，无法实现最新 Phase 9 primary surface。
- **HIGH**: Replay 输出只监听 `eventStream`，但当前协议有 `replay.output` frame，Plan 02/05 没打通。
- **MEDIUM**: TerminalScreen `dispose()` 中 `context.read<RelayClient>()` 有 Flutter 生命周期风险；通常应在 `didChangeDependencies` 缓存引用。
- **MEDIUM**: TerminalScreen 只支持 RelayClient，不再需要 LanClient 倒是符合最新方向，但 Plan 04/03 又引入 LAN，整体不一致。
- **MEDIUM**: `TerminalView readOnly:false` + observe mode snackbar 可能仍弹键盘/接收本地编辑语义，需要确认 xterm readOnly 动态切换是否更合适。
- **LOW**: AppBar title 用 sessionId fallback 可用，但 ReplayScreen 没查 session title/provider，不符合 D-38。

**Suggestions**

- 新增或替换为 `ChatSessionScreen` / `ChatView` 计划：bubble、tool cards、typing/activity、select options、markdown/code block、unread scroll FAB。
- Terminal 只作为 secondary tab，保留 xterm、resize、observe/control、pinch zoom。
- KeyboardToolbar 移到 deferred 文档，不写本期代码。
- RelayClient 增加 `replay.output` stream 或统一 terminal output abstraction，Terminal/Replay 不应猜 frame 类型。
- 增加 HarmonyOS xterm 渲染 smoke test 或至少人工验证步骤，因为 terminal 是 OHOS 风险最大点之一。

**Risk Assessment**
**HIGH**。它实现了"旧 Terminal-first + toolbar"而不是"Chat-first + terminal secondary"。

---

## Plan 06 Review

**Summary**
Plan 06 的 gate 意识正确：全量 Flutter 验证、pnpm 隔离、OHOS 文档和 human checkpoint 都需要。但它仍把 LAN 和 KeyboardToolbar 纳入人工验收，还把 OHOS 真机标准写得偏弱，不能有效证明最新 D-02 的 chat + WebSocket 在 HarmonyOS 可用。

**Strengths**

- 有完整命令序列：`flutter pub get`、`gen-l10n`、`analyze`、`test`、`build apk`。
- 明确 `pnpm typecheck` 不能替代 Flutter 验证。
- OHOS_SETUP / OHOS_NOTES 文档化是必要产物。
- human verify checkpoint 合理，Flutter/HarmonyOS 不能全靠单元测试。

**Concerns**

- **HIGH**: 手动验收仍包含 Settings Relay/LAN 切换、KeyboardToolbar、Terminal-first，不符合最新范围。
- **HIGH**: OHOS 验收不能只"记录 gap"；D-02 明确 first-version target 包括 HarmonyOS，至少 chat view + WebSocket 要在 OHOS 真机或模拟器验证，否则应标 phase 未完成或 human_needed。
- **MEDIUM**: `flutter build apk --debug` 只覆盖 Android，不覆盖 OHOS plugin runtime。
- **MEDIUM**: OHOS_NOTES 模板大量 `[待测试]` 可能被误当作完成。应把未测项列入 blocking/non-blocking 明确状态。
- **MEDIUM**: `pnpm list -r | grep -i flutter` 可能因文档/包描述误报；更可靠是检查 `pnpm-workspace.yaml` package globs 或 `pnpm -r exec pwd`。
- **LOW**: 日期模板是 2026-05-04，和当前 Phase 9 决策更新时间 2026-05-08 不一致。

**Suggestions**

- 更新 human verify 为：登录 -> Relay session list -> 默认 Chat view -> chat send/select/tool card/render -> Terminal toggle -> Replay -> theme/locale -> OHOS chat + WS。
- OHOS_NOTES 必须分为 `Verified`、`Blocked by environment`、`Known incompatible`，不能用模糊待测试。
- 如果当前机器无 DevEco/OHOS 环境，Phase 9 应保留 `human_needed`，不要标 complete。
- 加一条协议 drift check：Dart protocol 与 `packages/protocol/src/index.ts` variant/field 对齐。

**Risk Assessment**
**MEDIUM-HIGH**。作为 gate 是必要的，但 gate 内容目前验错目标。

---

## Cross-Plan Risks

- **范围漂移是最大问题**：最新 `09-CONTEXT.md` 已变为 Relay only、Chat-first、Bottom Tab、KeyboardToolbar deferred；计划仍是 LAN + Terminal-first + toolbar。
- **协议漂移会导致运行时失败**：当前 TS 协议 8+8，计划 7+7；漏 `client.chat` 和 `replay.output` 会直接破坏 Chat 和 Replay。
- **依赖顺序需要重排**：Plan 03 应删除/延期；Plan 04/05 应依赖新的 Chat/Relay protocol 支持，而不是 LanClient。
- **OHOS 风险没有前置锁定**：计划列了 OHOS 文档，但实际插件、xterm、secure storage、WebSocket、flutter_ohos fork 兼容性仍大多留到最后。
- **测试容易绿色但产品失败**：现有测试多为 widget/unit 测试，缺 Relay frame integration、protocol conformance、Chat rendering、reconnect resume、token revoke/logout、observe-mode denial 等关键行为。

## Recommended Plan Fix

1. 先更新 Phase 9 plan bundle，明确废弃 Plan 03 或移到 deferred。
2. Plan 01 重做 Dart protocol：按当前 `packages/protocol/src/index.ts` 的 8+8 + `RelayAuthScope` + fields。
3. Plan 02 增加 `client.chat`、`replay.output`、auth failure no-reconnect、full WS URL handling。
4. 新增/替换 Plan 04/05 为 Chat-first：`MainShell`、SessionList、SessionScreen(Chat default + Terminal toggle)、Replay。
5. KeyboardToolbar、LAN direct、manual Gateway URL 从本期执行计划移出。
6. Plan 06 的 OHOS gate 改为：必须验证 HarmonyOS chat view + WebSocket；无法验证则 Phase 9 保持 `human_needed`。

---

## Consensus Summary

（单一 Codex 评审，无需多评审者共识合并）

### Agreed Strengths

- Flutter 构建与 pnpm workspace 完全隔离，边界清晰
- 安全 token 存储方向正确（flutter_secure_storage）
- Wave 结构合理，基础层先行
- 测试意识整体比"无测试"计划好

### Agreed Concerns

- **协议漂移**（HIGH）：Dart 类型 7+7，TS 源已是 8+8，缺 `client.chat`/`replay.output`
- **范围漂移**（HIGH）：LAN direct、KeyboardToolbar、Terminal-first 均已在 CONTEXT 中移除/推迟，计划未更新
- **导航模型错误**（HIGH）：纯堆栈路由 vs. Bottom Tab Bar + Chat-first session view
- **OHOS 验收过弱**（HIGH）：需要在 OHOS 设备/模拟器实际验证 chat + WebSocket

### Divergent Views

N/A（单一评审者）
