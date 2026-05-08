---
phase: 09
plan: 02
subsystem: flutter-services
tags: [flutter, auth, relay, dio, websocket]
key_files:
  created:
    - native/flutter/lib/services/relay_client.dart
    - native/flutter/test/auth_service_test.dart
    - native/flutter/test/relay_client_test.dart
  modified:
    - native/flutter/lib/services/auth_service.dart
    - native/flutter/lib/main.dart
---

# Phase 9 Plan 02 Summary

实现了 `AuthService` 和 `RelayClient`：token 存储、登录/注册/静默刷新、Relay WS 状态机、replay output 流和 chat frame 发送都已接通。

## Verification Results

- `flutter test test/auth_service_test.dart test/relay_client_test.dart` ✅
- `flutter analyze` ✅

## Decisions

- `RelayClient` 采用可注入 socket factory，便于单元测试覆盖 auth failed / replay output / resubscribe
- `AuthService` 使用独立 `refreshDio`，避免刷新请求与常规请求共享错误路径

## Self-Check: PASSED
