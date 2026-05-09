# 12-04 Summary

- Added `GET /api/sessions`, `GET /api/sessions/:id/conversation`, and `GET /api/sessions/:id/events` on the server.
- Added account/workspace scope checks in `apps/server/app/service/sessionRepository.ts` before conversation and event reads.
- Added nginx routing for localhost-only `/api/runtime-sync/` and GET-vs-POST splitting on `/api/sessions*`.
- Preserved client compatibility by unwrapping either Egg `{ code, data }` envelopes or raw Relay JSON in the web and Flutter session readers.
- `events` supports both the new `before` cursor and the existing `after` cursor used by current direct-mode replay code.
