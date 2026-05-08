# Tether Flutter Client

Phone-first Flutter client for remote Agent session monitoring and control via Relay.

## Platforms

- Android
- iOS
- HarmonyOS (via OHOS Flutter fork 3.22.0 — `flutter_ohos`)

> **SDK:** Uses Huawei-led OHOS Flutter fork. Init command:
> `flutter create . --platforms android,ios,ohos`
> Requires DevEco Studio (OHOS) + Xcode (iOS) + Android Studio (Android).

## Running

项目使用 [FVM](https://fvm.app) 管理 Flutter 版本（已锁定 3.41.9）。

```bash
# 安装 / 切换到锁定版本
cd native/flutter
fvm use        # 读取 .fvmrc，自动安装 3.41.9（如未缓存）

# 安装依赖
fvm flutter pub get

# 运行到设备/模拟器
fvm flutter run

# 静态分析
fvm flutter analyze

# 测试
fvm flutter test
```

或者配置 IDE（VS Code / Android Studio）使用 FVM，之后直接用 `flutter` 命令。

> These commands run separately from the pnpm workspace.
> `pnpm typecheck` and `pnpm test` at repo root do NOT touch Flutter.

## Architecture

```
lib/
  main.dart               Entry point
  app.dart                MaterialApp, theme, i18n, router init
  router.dart             go_router — Bottom Tab Bar + session routes
  l10n/                   ARB files (zh / en)
  models/
    protocol.dart         Dart mirror of packages/protocol/src/index.ts
    chat_message.dart     ChatMessage, SelectPayload
  services/
    auth_service.dart     Login, token storage (flutter_secure_storage), refresh
  screens/
    login_screen.dart
    sessions/
      session_list_screen.dart
    session/
      chat_screen.dart    Primary view — matches H5 ChatSessionSurface
      terminal_screen.dart  Secondary view — xterm widget
    settings/
      settings_screen.dart
```

## Navigation

Bottom Tab Bar:
- **Sessions** tab → session list → chat (primary) / terminal (toggle)
- **Settings** tab → locale, theme, sign out

## Connection

Relay only (remote). LAN direct mode is deferred.
Server URL default is set at build time in `lib/services/auth_service.dart`.
Relay WS URL is derived from Server URL automatically.

## Dart Protocol Types

`lib/models/protocol.dart` hand-mirrors `packages/protocol/src/index.ts`.
A codegen placeholder lives at `packages/protocol/scripts/gen-dart.ts` (future).
Do not maintain a separate Dart contract that diverges from the TypeScript source.
