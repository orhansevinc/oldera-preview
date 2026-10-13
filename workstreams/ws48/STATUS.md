# WS48 Status

- WS: WS48
- Branch: `ws48-abuse-protection`
- Scope: common server-side rate-limit / abuse-protection contract and middleware
- Status: COMPLETE

## Delivered

- `@oldko/abuse-protection` framework-agnostic ESM package
- actor/IP/account/service HMAC key builder and safe bucket fingerprinting
- trusted proxy contract with guarded `X-Forwarded-For` resolution
- fixed-window, sliding-window and token-bucket in-memory adapter
- distributed store `consume()` interface contract
- uniform allow/deny and Retry-After decision model
- explicit policy-level fail-open/fail-closed behavior
- trusted internal service modes (`same`, `separate`, exceptional `bypass`)
- observability hooks that omit raw key/IP/account data
- reusable middleware and RateLimit header helper
- baseline policies for all requested use cases
- tests and WS48-only GitHub Actions workflow
- integration instructions without modifying other services

## Boundaries respected

No Account API, Admin API, gateway, game service, client/site, database migration or main-branch merge changes are included.

## Production note

`InMemoryRateLimitStore` is not a distributed production backend. Multi-instance deployment requires an atomic distributed adapter (for example Redis with an atomic script/transaction) implementing the documented store contract.
