# Phase 22 Spec: Unified App Shell Architecture

## Intent

Turn Tether into a coherent app product without fragmenting execution authority or protocol contracts across Web, Flutter, Tauri, and future native shells.

## Recommendation

Web/PWA remains the canonical UI in the near term. Flutter is the recommended mobile native path for iOS/Android/HarmonyOS exploration. Desktop should start as a lightweight Tauri/WebView shell around the existing Web app and local Gateway status/deep links. Electron is not the default because Tether does not need a bundled Node runtime inside the desktop renderer.

## Why not direct Flutter rewrite now

The current Flutter source is only a demo shell. The Web app already has auth, chats, terminal, Relay, Server DB history, and workbench layout. Rewriting everything in Flutter before approvals and mobile actions stabilize would duplicate product logic and create a second protocol.

## Why not Electron by default

Electron is useful when the desktop app itself needs deep Node integration. Tether's architecture already puts privileged execution in Gateway. A desktop shell should attach to Gateway, not become Gateway. Tauri/WebView is smaller and better aligned with this boundary.

## Target boundary

- Gateway owns execution and provider processes.
- Relay routes authenticated frames.
- Server owns auth, session metadata, history, approvals, and audit.
- Web/PWA, Flutter, and desktop shell are attach/supervision clients.
- `packages/protocol` is the canonical contract.
- Dart protocol types are generated or derived; no hand-maintained second canonical protocol.

## In scope

- App shell contract.
- PWA install/offline-cache hardening.
- Flutter auth/Relay/HTTP foundation.
- Flutter screens for Login, Gateway selector, Chats, Terminal, Approvals, Settings/Diagnostics.
- Terminal rendering spike and documented fallback.
- Tauri-first desktop shell decision.
- HarmonyOS plugin compatibility research.

## Out of scope

- Rebuilding Gateway in Flutter.
- Duplicating auth/approval decisions in app clients.
- Replacing the Web app before contracts stabilize.
- Offline command execution from phone.

## Acceptance

1. App shell contract maps every screen to its source APIs and protocol frames.
2. Flutter can authenticate, refresh token, connect Relay WS, list sessions, open chat, open terminal, decide an approval, and show diagnostics in a verification build.
3. PWA install is safe and does not cache sensitive terminal/session API payloads incorrectly.
4. Desktop shell decision is documented as Tauri-first with Electron fallback criteria.
5. HarmonyOS risks are documented before plugin choices are locked.
