# OHOS Compatibility Notes

## Verified

- `native/flutter/` 已建立独立 Flutter 工程，不影响根目录 `pnpm typecheck`
- `flutter analyze` 通过
- `flutter test` 通过
- Dart 协议桥 `native/flutter/lib/models/protocol.dart` 与 `packages/protocol/src/index.ts` 当前都是 8 个 client frames + 8 个 server frames
- `native/flutter/android/aliyun.init.gradle` + `./scripts/assemble-debug-apk.sh` 已验证能把 Flutter included Gradle build 的 Google Maven 解析切到 Aliyun mirrors

## Blocked by environment

- `flutter build apk --debug` 在当前环境仍会被 Gradle 远程依赖 TLS/handshake 阻塞；可用 mirror helper 绕过这一层
- mirror helper 绕过网络问题后，Android build 继续阻塞在 **本机未安装 NDK 27.0.12077973**
- `flutter build hap --debug` 当前 Flutter CLI 直接报 `Could not find an option named "--debug"`，且本仓库尚无 `ohos/` 平台目录
- 当前会话未安装 / 未初始化 DevEco Studio 与 OHOS toolchain，无法做真机或模拟器验证

## Known incompatible / gaps

- 当前实现按 Phase 9 最新上下文走 **Relay-only**，未实现早期 ROADMAP 文本里的 LAN direct 路径
- OHOS 打包链路尚未实测，因此 `xterm`、`flutter_secure_storage_ohos` 与 Relay WebSocket 在 OHOS 上仍需人工验收
