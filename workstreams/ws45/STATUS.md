# WS45 Status

- Workstream: `WS45`
- Branch: `ws45-session-ownership`
- Base: `main`
- State: `COMPLETE`
- Integration readiness: `READY` with one infrastructure condition: production must supply a shared atomic lease-store adapter.

## Delivered

- Account session leases.
- Character session leases with account-ownership precondition.
- Configurable duplicate-login policy (`reject-new` / `replace-old`).
- Stale lease reclaim.
- Heartbeat renewal.
- Crash recovery through lease expiry.
- Reconnect grace and CAS resume primitive.
- Disconnect cleanup with idempotent grace behavior.
- Compare-and-set ownership store contract.
- Account-ban active-session revoke interface.
- GM kick/session revoke interface.
- In-memory reference/test adapter.
- Race/concurrency tests.
- GitHub Actions workflow.
- Integration notes without modifying WS03/WS07/WS13/gateway.

## Verification

Command:

```bash
node --test tests/session-ownership/*.test.js
```

Result at implementation time:

```text
14 tests
14 pass
0 fail
```

Concurrency coverage includes an adversarial two-party CAS gate forcing two login attempts to observe the same empty account slot before either write completes. Exactly one session wins.

## Boundaries respected

No files outside these allowed areas are changed:

- `services/session-ownership/**`
- `tests/session-ownership/**`
- `workstreams/ws45/**`
- `.github/workflows/ws45-sessions.yml`

No DB migration, client, admin, site, gateway, WS03, WS07, or WS13 implementation change is included.
