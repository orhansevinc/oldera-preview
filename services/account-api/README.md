# OldKO Public Account API (WS13)

Public player-account lifecycle service for `oldkoweb.com`. It is intentionally separate from WS08 Admin API and from the KO 1298 protocol/session server.

## Canonical public endpoints

WS09 exposes the service below `https://oldkoweb.com/api/account` and strips `/api/account` before proxying. WS13 also accepts the public prefix directly for deterministic smoke testing.

- `POST /api/account/v1/accounts/register`
- `POST /api/account/v1/accounts/verification/request`
- `POST /api/account/v1/accounts/verification/confirm`
- `POST /api/account/v1/session/login`
- `GET /api/account/v1/session/current`
- `POST /api/account/v1/session/logout`
- `POST /api/account/v1/password/change`
- `POST /api/account/v1/password-reset/request`
- `POST /api/account/v1/password-reset/confirm`
- `GET /healthz` and `GET /readyz` for direct upstream health/readiness probes.

The pinned official `account-v15.js` still calls `/v1/accounts/password/change` and `/v1/accounts/password-reset/...`. Those exact paths remain supported as compatibility aliases; the frontend asset and its configured `/api/account` base are unchanged.

Passwords use canonical WS07-compatible scrypt with a random per-password salt. Reset/verification tokens are random bearer tokens; only SHA-256 digests are stored. Tokens are delivered in webhook JSON bodies and are never appended to URLs or emitted by the account service logger. Public reset/verification request responses remain generic to reduce account enumeration.

## Production fail-closed configuration

Production requires:

- `NODE_ENV=production`
- `DATABASE_URL`
- `OLDKO_ACCOUNT_REPOSITORY_MODULE` pointing to the exact WS07 `1ae85c96319cbab11648a91ed28300e17d4c607f` `services/oldko-data/src/adapters/ws13-account-api.js`; WS13 verifies the adapter Git blob SHA before boot.
- `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL` using HTTPS.
- `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET` from the deployment secret store.
- `OLDKO_ACCOUNT_ALLOWED_ORIGINS=https://oldkoweb.com` exactly.
- Explicit `OLDKO_TRUST_PROXY=0` or `1`; use `1` only behind the trusted WS09 reverse proxy that overwrites `X-Forwarded-For`.

Production refuses `InMemoryAccountRepository` and does not use process-local rate limiting. Apply `sql/0001_postgres_rate_limit.sql` (or run `npm run migrate:rate-limit`) after the pinned WS07 migrations and before starting WS13. `/readyz` remains 503 until both the WS07 PostgreSQL repository and shared rate-limit table are reachable.

The session cookie is `oldko_session; Secure; HttpOnly; SameSite=Strict; Path=/`. Logout requires an allowed `Origin`; the cookie is revoked in PostgreSQL and cleared client-side.

## Validation

```bash
npm install --prefix services/account-api
npm test --prefix services/account-api
```

The CI PostgreSQL job additionally checks out the pinned WS07 adapter and official-site handoff, applies real migrations, validates the frontend route contract, runs the public HTTP account lifecycle, verifies logout/password-version revocation, checks shared rate limiting, and verifies WS13 hashes with WS07's actual `verifyPassword()` implementation.
