# Tether Flutter Client

## Local commands

```bash
cd native/flutter
flutter analyze
flutter test
flutter build apk --debug
./scripts/assemble-debug-apk.sh
```

## Scope

- Relay-first mobile client surface
- Chat-first session UI with terminal as secondary tab
- Standalone Flutter app outside the pnpm workspace

## Related docs

- `native/flutter/OHOS_SETUP.md`
- `native/flutter/OHOS_NOTES.md`

## Android mirror helper

`./scripts/assemble-debug-apk.sh` runs Gradle with `android/aliyun.init.gradle` so Flutter's included Gradle build can resolve Android artifacts through Aliyun mirrors in environments where `dl.google.com` TLS handshakes fail. It still requires the Android SDK and the preferred NDK version from the local toolchain.
