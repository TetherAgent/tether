# Native Clients

This directory is a reserved area for future native clients.

- Native clients are client surfaces for Tether Gateway / Relay.
- They must not duplicate Gateway business logic such as session ownership, auth decisions, relay routing, or process control.
- They should consume stable protocol definitions from `packages/protocol`.
- This directory is not part of the current pnpm workspace build, typecheck, or test pipeline.
- Initialize real Flutter or HarmonyOS projects only after Gateway and Protocol are stable.

Planned placeholders:

- `native/flutter/` — Flutter app or generated Dart SDK experiments.
- `native/harmony/` — HarmonyOS app or generated ArkTS SDK experiments.
