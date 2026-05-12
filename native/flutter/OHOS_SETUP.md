# HarmonyOS / OHOS Flutter 环境

## 必需工具

1. OHOS Flutter fork 3.22.0（HarmonyOS 构建必须使用 OpenHarmony fork，不是标准 Google Flutter）
2. DevEco Studio / hvigor / ohpm
3. Android Studio / Xcode（跨平台构建）
4. FVM（可用于切换本机标准 Flutter；OHOS fork 仍需单独配置）

## 本地验证命令

```bash
cd native/flutter
fvm flutter pub get
fvm flutter analyze --no-pub
fvm flutter build apk --debug
./scripts/assemble-debug-apk.sh
```

## Android 构建镜像绕行

如果当前网络环境无法与 `dl.google.com` 完成 TLS 握手，可使用：

```bash
cd native/flutter
./scripts/assemble-debug-apk.sh
```

该脚本会通过 `android/aliyun.init.gradle` 尝试让 Flutter/Gradle 的 settings 级仓库走 Aliyun mirrors。当前环境下仍会触发 Android SDK manifest TLS/handshake 问题，并且本机还缺 Android SDK 对应的 **NDK 27.0.12077973**。

## OHOS 构建说明

当前会话环境使用标准 Flutter 3.41.9，`fvm flutter build hap --debug` 不支持 `--debug` 参数，
`fvm flutter build hap` 也没有 `hap` subcommand。说明当前机器不是 OHOS Flutter fork 环境。
仓库当前也尚未生成 `ohos/` 平台目录。

建议在具备 OHOS Flutter fork + DevEco Studio 的机器上执行：

```bash
cd native/flutter
flutter create . --platforms android,ios,ohos
flutter build hap
```

## pnpm 隔离

`native/flutter/` 不在 `pnpm-workspace.yaml` 的 workspace globs 中；根目录 TypeScript 验证继续使用 `pnpm typecheck`，Flutter 侧单独运行 `flutter analyze` / `flutter test`。

## 当前 Flutter 范围

当前 Flutter 客户端已降级为最小 demo 页面。旧的 Relay、登录、会话、终端、l10n 和测试代码已移除；OHOS 验证文档只保留平台环境和打包链路说明。
