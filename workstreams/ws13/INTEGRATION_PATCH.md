# WS13 Integration Patch

WS13 intentionally does not modify WS07, WS03, website, client, admin, or database migrations.

## WS07 repository adapter

Production must provide a module via `OLDKO_ACCOUNT_REPOSITORY_MODULE` exporting:

```js
export async function createAccountRepository({ env }) { return repository; }
```

The returned repository must implement `AccountRepository` from `services/account-api/src/repository.js`:

- `createAccount(account)` with atomic unique username/email enforcement.
- `findByUsernameCanonical(canonical)`.
- `findByEmail(email)`.
- `findById(id)`.
- `updateAccount(id, patch)`.
- `createActionToken(record)`; persist digest only, never the bearer token.
- `consumeActionToken(kind, digest, now)` atomically; a token can be consumed once and must reject expired tokens.

Suggested WS07 mappings: account password hash, normalized username, normalized email, verification timestamp, password version, ban state, and a one-time account action token table. The exact schema remains owned by WS07.

## WS03 session integration

WS03 may use `POST /v1/accounts/access-check` as a credential/access boundary or reuse the repository/service contract after integration. Behavior after valid credentials:

- unverified -> HTTP 403 `ACCOUNT_UNVERIFIED`
- active/permanent ban -> HTTP 423 `ACCOUNT_BANNED` with non-sensitive ban metadata
- allowed -> HTTP 200 with `accountId`, `username`, `passwordVersion`
- bad credentials -> HTTP 401 generic `INVALID_CREDENTIALS`

Do not expose ban/account existence before credentials are valid.

## Delivery integration

Set `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL` and `OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET`. Webhook requests are HMAC-SHA256 signed over `<timestamp>.<raw-json-body>` with headers `X-OldKO-Timestamp` and `X-OldKO-Signature: sha256=<hex>`.

## Horizontal scaling

The bundled in-memory rate-limit store is test/dev only. Production multi-instance deployment should provide a shared store (for example Redis) while preserving WS13 limits and keys. No production secret is committed.
