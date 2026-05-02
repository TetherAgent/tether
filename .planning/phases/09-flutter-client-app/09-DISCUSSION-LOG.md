# Phase 9: Flutter Client App - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 09-flutter-client-app
**Areas discussed:** Terminal Widget 选型, 登录 & 服务器配置 UX, 移动端输入 UX, App 骨架 & 构建隔离, WS 重连策略, Session 列表屏导航, App 内导航结构, 控制/观察模式切换, LAN 直连模式

---

## Terminal Widget 选型

| Option | Description | Selected |
|--------|-------------|----------|
| xterm (pub.dev, 纯 Dart) | TerminalStudio 维护的纯 Dart VT100/ANSI 终端，无 native 绑定，理论上 iOS/Android/HarmonyOS 都跑得了 | ✓ |
| WebView + xterm.js | 在 Flutter WebView 里嵌 xterm.js，和 Web 端用同一个渲染引擎，功能完整但较重 | |
| 先 spike 验证再决定 | 在规划前先用 xterm pub.dev 在真机/模拟器验证 alternate screen + 鸿蒙兼容性 | |

**User's choice:** xterm (pub.dev) — 纯 Dart
**Notes:** 用户确认三平台都要支持：Android、iOS、HarmonyOS。鸿蒙通过 flutter_ohos 实现，第一版验证能跑就算成功。

---

## HarmonyOS 策略

| Option | Description | Selected |
|--------|-------------|----------|
| 第一版就做，验证就行 | 直接拥抱 flutter_ohos，在鸿蒙真机/模拟器上验证 xterm+WebSocket 能跑就算成功 | ✓ |
| 先 iOS/Android，鸿蒙明确标注待验证 | 第一版只保证 iOS/Android 跑通；鸿蒙在 CONTEXT.md 里标注为"需要局部验证"，不当需求封窗 | |

**User's choice:** 第一版就做，验证就行
**Notes:** 用户确认三平台并列为第一版目标。

---

## 终端降级备用

| Option | Description | Selected |
|--------|-------------|----------|
| 没有备用，生扛就行 | 如果 xterm 不起作用，就显示错误。不为影响低的边界 case 搞复杂度 | |
| 降级到纯文本输出 + 发送框 | 最坏情况：显示原始 terminal.output 文本（类似旧版 Web transcript）+ 一个输入框 | ✓ |

**User's choice:** 降级到纯文本输出 + 发送框
**Notes:** 降级 fallback 是兜底，不是目标。遇到时需要在文档中明确记录。

---

## 登录 & 服务器配置 UX

| Option | Description | Selected |
|--------|-------------|----------|
| 邮箱+密码表单，和 Web 端一致 | 登录屏显示输入邮箱和密码，请求 apps/server /login，存储 access + refresh token。注册也在应用内完成 | ✓ |
| 仅支持登录，不支持应用内注册 | 手机端只登录已有账号；注册流程引导到 Web | |

**User's choice:** 邮箱+密码表单，和 Web 端一致
**Notes:** 注册和登录都在 App 内完成，流程与 Web 端对齐。

---

## Server URL 配置

| Option | Description | Selected |
|--------|-------------|----------|
| 引导页手动填入 Server URL | 首次启动展示引导，要求用户输入 Server 地址 | |
| 扫描二维码从 Web 端导入 | Web 端设置页显示二维码，手机扫描后自动导入 Server URL 和 session token | |
| 内置默认 URL，设备里可改 | Server URL 有内置默认值，用户可在设备设置里修改，但设置 UI 本期不做 | ✓ |

**User's choice:** 默认 https://tether.example.com，设备里面可以改，这期也不做
**Notes:** Server URL 配置界面本期不做，App 内置默认值，变更 UI 延迟到后续阶段。

---

## Relay URL 配置

| Option | Description | Selected |
|--------|-------------|----------|
| Server 自动提供 Relay URL，用户不需单独填 | 登录 Server 后，就能拿到 Relay 地址。用户只填一个 Server 地址就够 | ✓ |
| Relay URL 单独配置 | Server 和 Relay 地址分开设置（如果用户单独自建 Relay） | |

**User's choice:** Server 自动提供 Relay URL，用户不需单独填
**Notes:** Relay URL 由 Server 下发，简化用户配置路径。

---

## Token 存储

| Option | Description | Selected |
|--------|-------------|----------|
| flutter_secure_storage | iOS Keychain / Android Keystore / HarmonyOS 等效存储。是手机端 token 标准做法 | ✓ |
| SharedPreferences | 不加密，和 Web 端 localStorage 一样简单但安全度低。仅适合开发展示 | |

**User's choice:** flutter_secure_storage
**Notes:** 从第一版就用安全存储，不走 Web 端 localStorage 的临时方案。

---

## 移动端输入 UX — 工具条

| Option | Description | Selected |
|--------|-------------|----------|
| 键盘上方工具条 | 键盘弹出时显示一行工具条：Ctrl、Tab、Esc、↑↓←→、| 等控制键 | ✓ |
| 只用系统键盘，不加工具条 | 依赖系统软键盘，手机端不提供额外控制键 | |

**User's choice:** 键盘上方工具条（Ctrl、Esc、Tab）
**Notes:** 用户明确指定只要 Ctrl、Esc、Tab 三个键，不要方向键。

---

## 字体大小 & 屏幕方向

| Option | Description | Selected |
|--------|-------------|----------|
| 双指缩放字体 + 自由旋转屏幕 | 抚屏放大/缩小字体，支持横竖屏。横屏对终端更友好 | ✓ |
| 固定字体，竖屏路决定方向 | 不提供字体控制，属于最少实现策略 | |

**User's choice:** 双指缩放字体 + 自由旋转屏幕

---

## App 骨架 & 构建隔离

| Option | Description | Selected |
|--------|-------------|----------|
| native/flutter/ 直接放进去 | 和项目已有的 native/ 规划一致，native/README.md 里也已标记这个位置 | ✓ |
| 单独 apps/flutter/ | 和其他 apps 平齐放置，但和 native/ 规划存冲突 | |

**User's choice:** native/flutter/ 直接放进去

---

## Dart 协议类型第一版

| Option | Description | Selected |
|--------|-------------|----------|
| 手写最小集 + 标注生成备备 | 第一版手写与 Relay 协议对齐的 Dart 类型；同时在 packages/protocol 下加一个 codegen 脚本占位符，方便后续替换 | ✓ |
| 就 quicktype 生成，不手写 | 用 quicktype 从 TypeScript 或 JSON Schema 直接生成 Dart。编译时运行 codegen，不手动维护 | |

**User's choice:** 手写最小集 + 标注生成备备

---

## Flutter 验证隔离

| Option | Description | Selected |
|--------|-------------|----------|
| native/ 完全隔离，Flutter 自己的 flutter test / flutter analyze | pnpm 工作区不包含 native/，Flutter 验证命令单独在 native/flutter/ 运行 | ✓ |
| 在 pnpm 根 package.json 加 flutter 脚本 | 尝试统一入口。但需要 Flutter SDK 在 CI 里就位，增加复杂度 | |

**User's choice:** native/ 完全隔离，Flutter 自己的 flutter test / flutter analyze

---

## WS 重连策略

| Option | Description | Selected |
|--------|-------------|----------|
| 自动重连 + 指数退避 | WS 断开后自动重连，间隔指数增长（1s/2s/4s/8s 上限 30s）。App 恢复前台时立刻触发重连 | ✓ |
| 断开就显示错误，用户手动刷新 | 不自动重连，显示断连状态 + 刷新按钮 | |

**User's choice:** 自动重连 + 指数退避

---

## 重连后终端内容恢复

| Option | Description | Selected |
|--------|-------------|----------|
| 用 latestEventId 继续订阅，补充错过的事件 | 和 Web 端一致：中断期间错过的 terminal.output 通过 after=latestEventId 重播，用户看到无缝恢复 | ✓ |
| 重连后清空终端重新全量载入 | 断线后重连时从头 replay，终端内容会闪烁一下 | |

**User's choice:** 用 latestEventId 继续订阅，补充错过的事件

---

## Session 列表展示

| Option | Description | Selected |
|--------|-------------|----------|
| 活跃/历史分区展示，历史可展开 | 上方明显显示活跃 session，下方展开历史（最多 8 个）。和 Web 端结构一致 | ✓ |
| 全部展开，不分区 | 一个列表展示所有 session，用状态标签区分活跃/历史 | |

**User's choice:** 活跃/历史分区展示，历史可展开

---

## Session 停止交互

| Option | Description | Selected |
|--------|-------------|----------|
| 滑动 session 卡片出停止按钮 | 左滑或右滑展开操作区，显示"停止"按钮。手机常见模式 | ✓ |
| 进入 session 详情后再停止 | 列表只有进入操作，停止在终端详情屏内操作 | |
| 长按卡片弹出操作菜单 | 长按 session 卡片展示菜单：进入、停止 | |

**User's choice:** 滑动 session 卡片出停止按钮

---

## App 内导航结构

| Option | Description | Selected |
|--------|-------------|----------|
| 栈式导航（登录→Session 列表→终端） | 登录后直接进入 Session 列表，点击 session 入终端，返回按钮回到列表。无底部 Tab，最简。设置通过导航栏法入 | ✓ |
| Tab 导航（Session、设置） | 底部 Tab Bar：Session 列表 + 设置。终端屏推入展示，返回关闭 | |

**User's choice:** 栈式导航（登录→Session 列表→终端）

---

## 控制/观察模式切换

| Option | Description | Selected |
|--------|-------------|----------|
| 终端屏顶部切换按钮 | 终端上方显示当前模式（控制/观察），点击切换。简单明了 | ✓ |
| 这期只做控制模式 | 手机端第一版只支持控制模式，观察模式延迟 | |

**User's choice:** 终端屏顶部切换按钮

---

## LAN 直连 Gateway 发现

| Option | Description | Selected |
|--------|-------------|----------|
| 手动填入 Gateway 地址 | 设置屏里填入内网 IP，如 http://192.168.1.x:4789。简单可靠 | ✓ |
| mDNS 自动发现 | Gateway 广播 mDNS，App 自动发现内网 Gateway。更好的体验但需要 Gateway 广播 + 手机端 mDNS 监听 | |

**User's choice:** 手动填入 Gateway 地址

---

## 连接模式切换

| Option | Description | Selected |
|--------|-------------|----------|
| 设置屏统一配置，切换后刷新列表 | 设置屏里选择 Relay 或 LAN 直连，切换后 Session 列表自动更新。和 Web 端的 header 内切换类似但在手机设置屏里 | ✓ |
| 自动检测，优先 LAN | 检测到同一局域网时自动切到 LAN，否则 Relay。体验好但实现复杂 | |

**User's choice:** 设置屏统一配置，切换后刷新列表

---

## Claude's Discretion

- 具体 Dart 包版本（xterm、flutter_secure_storage、freezed/sealed class、http client）
- native/flutter/ 内部 Dart 文件和模块结构
- Ctrl 修饰键的具体实现（hold-state vs 直接发控制字节）
- UI 文字语言（中文或英文，planner 可默认中文匹配 Web 端）
- Token refresh 的重试次数和间隔

## Deferred Ideas

- Settings screen UI for Server URL change — 本期不做
- 方向键工具条 — 用户只要了 Ctrl/Esc/Tab
- mDNS 自动发现 LAN Gateway — 延迟
- Desktop Flutter — 延迟
- Admin 管理台 — Phase 6 Web 专属功能
- APNs / FCM offline push — 延迟（PUSH-01 是 v2 需求）
- 底部 Tab Bar 导航 — 延迟
