# Tether Flutter Demo

## Local commands

```bash
cd native/flutter
flutter analyze
flutter build apk --debug
./scripts/assemble-debug-apk.sh
```

## Scope

- 当前只保留一个最小 demo 页面。
- Relay、登录、会话列表、聊天、终端和设置等旧业务代码已移除。
- Android / iOS 工程壳仍保留，方便后续重新搭建客户端。

## Related docs

- `native/flutter/OHOS_SETUP.md`
- `native/flutter/OHOS_NOTES.md`

## Android mirror helper

`./scripts/assemble-debug-apk.sh` runs Gradle with `android/aliyun.init.gradle` so Flutter's included Gradle build can resolve Android artifacts through Aliyun mirrors in environments where `dl.google.com` TLS handshakes fail. It still requires the Android SDK and the preferred NDK version from the local toolchain.
