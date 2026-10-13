# OldKO Public Account API (WS13)

Public player-account lifecycle service. It is intentionally separate from WS08 Admin API and from the KO 1298 protocol/session server.

## Endpoints

- `GET /healthz`
- `GET /openapi.json`
- `GET /v1/accounts/username/availability?username=...`
- `POST /v1/accounts/register`
- `POST /v1/accounts/access-check`
- `POST /v1/accounts/password/change`
- `POST /v1/accounts/password-reset/request`
- `POST /v1/accounts/password-reset/confirm`
- `POST /v1/accounts/verification/request`
- `POST /v1/accounts/verification/confirm`

Passwords use Node's native scrypt with a random per-password salt. Reset/verification tokens are random bearer tokens; only SHA-256 digests are stored. Public reset/verification request responses are deliberately generic to reduce account enumeration.

## Production configuration

No secrets belong in git. In production the process fails closed unless these integrations are provided:

- `OLDKO_ACCOUNT_REPOSITORY_MODULE`: module exporting `createAccountRepository({ env })` and implementing `AccountRepository`.
- `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL`
- `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET`
- `OLDKO_ACCOUNT_ALLOWED_ORIGINS`: comma-separated official origins.
- `OLDKO_TRUST_PROXY=1` only behind a trusted proxy that overwrites `X-Forwarded-For`.

The bundled in-memory repository is development/test-only. Rate-limit storage is also process-local; production multi-instance deployment should inject/shared-store the same `SecurityGate` semantics (for example Redis) at composition time.

## Tests

```bash
npm test --prefix services/account-api
```
