---
phase: 9
slug: flutter-client-app
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-04
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | flutter test (built-in) |
| **Config file** | native/flutter/pubspec.yaml |
| **Quick run command** | `flutter analyze && flutter test --no-pub` |
| **Full suite command** | `flutter analyze && flutter test --no-pub && flutter build apk --debug` |
| **Estimated runtime** | ~30 seconds (analyze + unit tests) |

---

## Sampling Rate

- **After every task commit:** Run `flutter analyze && flutter test --no-pub`
- **After every plan wave:** Run `flutter analyze && flutter test --no-pub && flutter build apk --debug`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| scaffold | 01 | 0 | SC-1 | build | `flutter build apk --debug` | ⬜ pending |
| protocol-types | 01 | 0 | SC-5 | unit | `flutter test test/protocol_test.dart` | ⬜ pending |
| auth-flow | 02 | 1 | D-07/D-10/D-11 | unit | `flutter test test/auth_test.dart` | ⬜ pending |
| session-list | 03 | 1 | SC-2/D-16~D-18/D-34~D-36 | widget | `flutter test test/session_list_test.dart` | ⬜ pending |
| relay-client | 04 | 1 | SC-2/D-22~D-24/D-35 | unit | `flutter test test/relay_client_test.dart` | ⬜ pending |
| terminal-screen | 05 | 2 | SC-2/SC-4/D-12~D-15/D-21 | widget | `flutter test test/terminal_screen_test.dart` | ⬜ pending |
| replay-screen | 06 | 2 | SC-2/D-37~D-38 | widget | `flutter test test/replay_screen_test.dart` | ⬜ pending |
| lan-direct | 07 | 2 | SC-3/D-25~D-27/D-36 | unit | `flutter test test/lan_client_test.dart` | ⬜ pending |
| i18n-theme | 08 | 2 | D-39/D-40 | unit | `flutter test test/i18n_test.dart` | ⬜ pending |
| ohos-compat | 09 | 3 | SC-6 | build | `flutter build hap --debug` | ⬜ pending |
| protocol-codegen | 10 | 3 | SC-5 | existence | `test -f packages/protocol/scripts/gen-dart.sh` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `native/flutter/` — Flutter project skeleton created (`flutter create . --platforms android,ios,ohos`)
- [ ] `native/flutter/test/` — test directory with stub test files
- [ ] `native/flutter/pubspec.yaml` — dependencies declared (xterm, flutter_secure_storage, dio, web_socket_channel, shared_preferences)
- [ ] OHOS plugin compatibility confirmed: `flutter build hap --debug` exits 0 (or compatibility issues documented)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| xterm renders alternate-screen TUI (Codex/Claude full-screen) | SC-4 | Requires real terminal TUI session running through Relay | Attach to a running Claude session, verify full-screen TUI renders without artifacts |
| Pinch-to-zoom font scaling | D-14 | Gesture-based, no automated gesture test | Open terminal screen, pinch in/out, verify font scales between 10sp and 24sp |
| Ctrl modifier sends correct byte | D-12 | IME behavior varies by device | Tap Ctrl, then press 'c', verify ^C is sent to terminal |
| HarmonyOS terminal + WebSocket | SC-6 | Requires HarmonyOS device or simulator | Build hap, install, connect to Relay, verify session list and terminal work |
| Session replay playback | SC-2/D-37 | Requires historical session with events | Tap history session, verify terminal replays from event 0 in observe mode |
| Swipe-to-stop removes session | D-18 | Gesture on device | Swipe active session card left, tap 停止, verify session removed from list |
| Free rotation resize | D-15 | Physical rotation | Rotate device during active session, verify terminal cols/rows update |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
