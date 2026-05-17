# Phase 21 Spec: Mobile Quick Actions and Diagnostics

## Intent

Migrate the valuable mobile UX from NomadAI into Tether without copying the old tmux/ttyd/control_server architecture.

## Source projects

- NomadAI contributes bottom dock layout, key grid, guarded Ctrl-D, visualViewport keyboard lift, compact session tabs, pairing, and diagnostics.
- Tether contributes proper Gateway/Relay/session protocol. Quick actions must call Tether operations, not tmux send-keys wrappers.

## In scope

- Shared quick action model.
- Terminal quick dock for mobile.
- Chat quick actions that insert text/slash commands rather than secretly executing commands.
- Session action drawer.
- Guarded destructive shortcuts.
- Mobile keyboard/viewport handling.
- Connection diagnostics panel.
- QR/deep-link pairing using Tether auth/device trust.

## Out of scope

- Copying `control.html`.
- Copying `control_server.py`.
- tmux window/pane management as product API.
- Query-param token auth.
- Replacing Relay with NomadAI WebRTC/P2P.

## Quick action set

Terminal defaults:

- Esc
- Tab
- Up / Down / Left / Right
- Enter
- Ctrl-C
- Ctrl-D with double-tap confirmation
- y / n
- Paste
- Resize/reflow
- Detach
- Stop
- Observe/control toggle

Chat defaults:

- Insert common slash/GSD commands.
- Insert provider prompts/snippets.
- Jump to pending approval for current session.
- Approve/reject if a current-session request is pending and visible.

## Diagnostics

The diagnostics panel should show:

- Auth state
- Selected Gateway
- Gateway online/offline
- Relay WS status
- Active controller
- Current session id
- Last event sequence
- Reconnect stage
- HTTP history load status
- Recent error code

## Acceptance

1. Phone users can send Esc/Tab/arrows/Enter/Ctrl-C without opening a hardware keyboard.
2. Ctrl-D cannot be sent accidentally with one tap.
3. The dock stays visible above iOS/Android software keyboards.
4. Quick actions do not bypass authorization.
5. Diagnostics distinguish auth failure, Relay disconnected, Gateway offline, and history API failure.
6. QR/deep-link pairing never exposes long-lived raw tokens in URLs.
