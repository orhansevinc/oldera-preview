# WS13 Status

## Scope

Public Account API for normal OldKO players; separate from WS08 Admin API.

## Implemented

- Registration with canonical username/email uniqueness checks.
- Username format validation and availability endpoint.
- Native scrypt password hashing with random salt; no plaintext password persistence.
- Credential access-check boundary with verification and ban behavior.
- Password change with current-password verification and password-version rotation.
- Password reset request/confirm with non-enumerating request responses, random one-time tokens, digest-only persistence, expiry and single consume.
- Account verification request/confirm with the same one-time token properties.
- Per-IP request rate limits and per-IP+username credential brute-force protection.
- Input/body/content-type validation, body-size cap, request IDs, strict opt-in CORS and proxy trust.
- Security audit sink with no password/token logging.
- Health endpoint and OpenAPI 3.1 JSON endpoint.
- Generic signed delivery webhook; secrets are environment-only.
- Repository interface and dev/test in-memory adapter; production fails closed without an external repository module.
- CI workflow and Node test suite.

## Validation

`npm test --prefix services/account-api`

Result: **PASS — 7/7 tests**.

## Integration state

Conditional: production needs the WS07-backed repository adapter and shared rate-limit store, plus a configured delivery webhook. WS13 does not change WS07 migrations or any out-of-scope product code.
