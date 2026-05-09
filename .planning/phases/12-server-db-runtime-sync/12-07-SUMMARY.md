# 12-07 Summary

- Removed the Flutter conversation refresh fallback to `relayClient.requestConversation(sessionId)`.
- Flutter session reads now unwrap either Egg `{ code, data }` envelopes or raw Relay-style payloads.
- Static routing remains split so `POST /api/sessions/:id/input` and `POST /api/sessions/:id/stop` stay on Relay while read endpoints move to the server.
