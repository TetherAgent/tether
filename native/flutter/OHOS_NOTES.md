# OHOS Compatibility Notes

## Verified

- `native/flutter/` 已建立独立 Flutter 工程，不影响根目录 `pnpm typecheck`
- `pnpm typecheck` 通过（repo 根目录，2026-05-08）
- `pnpm -r exec pwd` 未包含 `native/flutter/`，pnpm workspace 隔离通过
- `fvm flutter pub get` 通过；过程中 `pub.flutter-io.cn` advisory 解码有 warning，但退出码为 0
- `fvm flutter gen-l10n` 通过
- `fvm flutter analyze --no-pub` 通过
- `fvm flutter test --no-pub` 通过，43 个测试全部通过
- Dart 协议桥 `native/flutter/lib/models/protocol.dart` 与 `packages/protocol/src/index.ts` 当前都是 8 个 client frames + 8 个 server frames
- `packages/protocol/scripts/gen-dart.sh` 存在、可执行、退出 0，当前作为手写 Dart bridge 的退出路径占位

## Blocked by environment

- `fvm flutter build apk --debug` 在当前环境被 Android SDK 远程 manifest TLS/handshake 问题影响，并继续阻塞在 **本机未安装 NDK 27.0.12077973**
- `native/flutter/android/aliyun.init.gradle` + `./scripts/assemble-debug-apk.sh` 可以执行到同一 Gradle 配置阶段，但当前仍受 Android SDK manifest TLS/handshake 与 NDK 缺失阻塞，未生成 debug APK
- `fvm flutter build hap --debug` 报 `Could not find an option named "--debug"`
- `fvm flutter build hap` 报 `Could not find a subcommand named "hap"`；当前 FVM SDK 是标准 Flutter 3.41.9，不是 OHOS Flutter fork
- 当前会话未安装 / 未初始化 DevEco Studio 与 OHOS toolchain，无法做 HarmonyOS 真机或模拟器验证
- 仓库当前尚无 `ohos/` 平台目录；需要在 OHOS Flutter fork 环境中执行 `flutter create . --platforms android,ios,ohos`

## Known incompatible / gaps

- 当前实现按 Phase 9 最新上下文走 **Relay-only**，未实现早期 ROADMAP 文本里的 LAN direct 路径
- OHOS 打包链路尚未实测，因此 `xterm`、`flutter_secure_storage_ohos` 与 Relay WebSocket 在 OHOS 上仍需人工验收
- Android smoke build 未通过前，Phase 9 不能标记为 complete；当前应保持 `human_needed` / environment blocked
