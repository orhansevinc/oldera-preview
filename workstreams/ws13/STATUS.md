# WS13 Status

## Scope

Public Account API for normal OldKO players; separate from WS08 Admin API.

## Production hardening

- Production boot fails closed without the exact pinned WS07 `PgWs13AccountRepository` adapter. The adapter file is verified against Git blob SHA `022c32abde503a6dc3af1ff9429c206a1b20ca63` from WS07 `1ae85c96319cbab11648a91ed28300e17d4c607f`.
- `InMemoryAccountRepository` and process-local rate limiting are development/test only.
- Production rate limiting uses PostgreSQL `oldko.account_rate_limits`; bucket identifiers are stored only as SHA-256 hashes.
- Production allowed origin is exactly `https://oldkoweb.com`.
- `OLDKO_TRUST_PROXY` must be explicitly `0` or `1`; `1` is reserved for the trusted WS09 reverse proxy.
- Session cookie remains `oldko_session; Secure; HttpOnly; SameSite=Strict; Path=/`.
- Logout retains trusted-Origin validation and PostgreSQL session revocation.
- `GET /v1/session/current` remains database-authoritative for session, account state, password version, ban state and characters.
- Password format remains canonical WS07-compatible `scrypt$N$r$p$base64(salt)$base64(hash64)` with legacy WS13 read compatibility.
- Production delivery fails closed at boot unless both webhook URL and secret exist; production webhook URLs must use HTTPS. Account tokens remain webhook-body-only and are never logged by WS13.
- Direct `/healthz` and dependency-aware `/readyz` are available for WS09 upstream probes.
- Public `/api/account/v1/...` paths are accepted directly and remain compatible with the official WS09 strip-prefix contract.

## Validation gates

CI runs unit/session tests plus a real PostgreSQL integration job. The integration job checks out exact WS07 `1ae85c96319cbab11648a91ed28300e17d4c607f` and official-site handoff `8370de2ebfdfd319cf8a719da79cbdef9853fd2f`, applies WS07 migrations and the WS13 rate-limit migration, then verifies:

- register -> verify -> login -> current session -> logout -> revoked session;
- password change invalidates prior session/password;
- password reset rotates password again;
- WS07 `verifyPassword()` accepts the WS13 canonical hash and rejects a wrong password;
- rate-limit state is shared across independent PostgreSQL-backed store instances;
- official `account-v15.js` keeps `/api/account` plus the exact WS13 `/v1/...` route set;
- untrusted logout Origin is rejected.

## Deployment handoff

`workstreams/ws13/PRODUCTION_ACCOUNT_SERVICE.json` is the machine-readable production manifest. Runtime deployment still requires external `DATABASE_URL`, the pinned WS07 module file, migrated database, and real delivery webhook secrets. No fake mail, dev token output or memory database is permitted in production.
