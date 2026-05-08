# HarmonyOS / OHOS Flutter 环境

## 必需工具

1. OHOS Flutter fork（项目当前使用本机 FVM Flutter）
2. DevEco Studio / hvigor / ohpm
3. Android Studio / Xcode（跨平台构建）

## 本地验证命令

```bash
cd native/flutter
flutter analyze
flutter test
flutter build apk --debug
```

## OHOS 构建说明

当前会话环境里 `flutter build hap --debug` 不支持 `--debug` 参数，且仓库尚未生成 `ohos/` 平台目录。

建议在具备 OHOS Flutter fork + DevEco Studio 的机器上执行：

```bash
cd native/flutter
flutter create . --platforms android,ios,ohos
flutter build hap
```

## pnpm 隔离

`native/flutter/` 不在 `pnpm-workspace.yaml` 的 workspace globs 中；根目录 TypeScript 验证继续使用 `pnpm typecheck`，Flutter 侧单独运行 `flutter analyze` / `flutter test`。
