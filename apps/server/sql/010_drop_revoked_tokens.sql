-- Phase: drop revoked_tokens blacklist table (2026-05-11)
-- Token revocation via blacklist has been removed; refresh token revocation in
-- gateway_refresh_tokens / refresh_tokens is the sole mechanism for invalidation.

DROP TABLE IF EXISTS revoked_tokens;
