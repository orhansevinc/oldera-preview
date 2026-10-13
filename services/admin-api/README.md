# OldKOWeb Admin API (WS08)

Backend for the existing `admin/` control center. The frontend remains read-only and is not modified by this workstream.

## Security model

- Authentication is server-side and cookie based (`HttpOnly`, `SameSite=Strict`, `Secure` in production).
- `actor`, `authority`, `ROOT_OWNER` and similar fields sent by the browser are ignored for authorization.
- Effective role/permissions come only from the signed authenticated server session.
- Passwords are stored as scrypt hashes. There are no built-in production credentials.
- Every dangerous mutation is validated, executed through `repository.transaction(...)`, and paired with an append-only audit write.
- `Idempotency-Key` is supported for mutations; repeated keys by the same authenticated actor return the first result.
- Critical commands require `commands:critical`, in addition to normal GM command permission.

## Repository / WS07 integration

`src/repository.js` is the integration boundary. A production adapter must implement every method in `REQUIRED_METHODS`. The API does **not** own migrations and intentionally does not modify `database/**`.

Expected mapping to WS07 concepts:

| Admin repository capability | Expected persistence |
| --- | --- |
| players / character details | `accounts`, `characters`, `character_stats`, session/online state |
| inventory / inn | `character_items` / `inventory`, `inn_storage` |
| account/IP sanctions | `bans`, `ip_bans` |
| serial trace / duplicate query | unique item serial indexed across character + inn item locations |
| audit | append-only `audit_log` |
| GM requests | durable command/outbox table or game-server command bridge |

Online-character writes should ultimately use the authoritative game/session service instead of blind SQL. The `enqueueCommand()` repository method is deliberately an outbox-style handoff: this workstream never calls the browser client and never trusts it to execute GM authority.

## Running

Node 20+ is sufficient; the service has no third-party runtime dependencies.

Required environment:

- `ADMIN_SESSION_SECRET`: at least 32 bytes.
- `ADMIN_USERS_JSON`: JSON array of `{id, username, passwordHash, roles}`.
- `ADMIN_REPOSITORY=memory` is the current explicit development adapter.

Generate a compatible password hash with `hashPassword()` exported from `src/security.js` in a trusted deployment/bootstrap script; do not store plaintext credentials in the repo.
