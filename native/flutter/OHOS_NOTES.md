# OHOS Compatibility Notes

## Verified

- `native/flutter/` 保留独立 Flutter 工程壳，不影响根目录 `pnpm typecheck`
- 当前 Flutter 代码只保留 `lib/main.dart` demo 页面
- Relay、登录、会话、终端、l10n、协议桥和 Flutter 测试代码已移除

## Blocked by environment

- `flutter` 当前不在本机 shell PATH 中，本会话未能运行 `flutter pub get` / `flutter analyze`
- 历史上 `fvm flutter build apk --debug` 在当前环境被 Android SDK 远程 manifest TLS/handshake 问题影响，并继续阻塞在 **本机未安装 NDK 27.0.12077973**
- `native/flutter/android/aliyun.init.gradle` + `./scripts/assemble-debug-apk.sh` 可以执行到同一 Gradle 配置阶段，但当前仍受 Android SDK manifest TLS/handshake 与 NDK 缺失阻塞，未生成 debug APK
- `fvm flutter build hap --debug` 报 `Could not find an option named "--debug"`
- `fvm flutter build hap` 报 `Could not find a subcommand named "hap"`；当前 FVM SDK 是标准 Flutter 3.41.9，不是 OHOS Flutter fork
- 当前会话未安装 / 未初始化 DevEco Studio 与 OHOS toolchain，无法做 HarmonyOS 真机或模拟器验证
- 仓库当前尚无 `ohos/` 平台目录；需要在 OHOS Flutter fork 环境中执行 `flutter create . --platforms android,ios,ohos`

## Known incompatible / gaps

- 当前 demo 页面不包含 Relay / LAN / session / terminal 行为
- OHOS 打包链路尚未实测
- 若后续恢复 Flutter 客户端，需要重新设计 Relay、认证、会话和终端能力
