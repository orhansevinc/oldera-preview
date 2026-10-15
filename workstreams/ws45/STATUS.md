# WS45 Status

- Workstream: `WS45`
- Branch: `ws45-session-ownership`
- Task start: `4a66338743553c2781c68ca84b866ff4e999c14e`
- State: `COMPLETE`
- Production shared atomic lease-store condition: `RESOLVED`.

## Delivered

- Account session leases.
- Character session leases with account-ownership precondition.
- Configurable duplicate-login policy (`reject-new` / `replace-old`).
- Stale lease reclaim, heartbeat renewal, crash recovery, reconnect grace, and CAS resume.
- Account-ban/session revoke and character-owner kick/revoke surfaces.
- In-memory reference/test adapter.
- `createPostgresLeaseStore(...)` backed by the single `oldko.session_leases` PostgreSQL table.
- Transactional PostgreSQL CAS using unique-key insert conflict semantics plus version-conditional update/delete.
- Atomic replace-old/stale-account cleanup of displaced character leases.
- WS45 service-owned migration and migration manifest; no changes to the WS07 numbered migration ledger.
- Narrow admin ownership contract for authoritative online leases and revoke/kick only.
- Real PostgreSQL multi-store race/restart/reconnect/admin integration tests.

## Production database contract

WS07 already establishes `oldko.session_leases` in `database/migrations/0002_persistence_hardening.sql`. WS45 uses that exact shared table rather than creating a second source of truth. The WS45 service migration is idempotent, is ordered after WS07 `0002`, and adds the explicit `expires_at` alias plus supporting indexes without modifying WS07 migration files.

Production configuration supplies `DATABASE_URL`; no connection string, password, auth secret, or session secret is committed or logged.

## Verification

The workflow `.github/workflows/ws45-sessions.yml` runs the original 16 in-memory/concurrency tests plus a PostgreSQL 16 integration suite covering:

- two independent stores forced through the same empty account state;
- exactly one reject-new winner;
- replace-old protection against stale heartbeat/release;
- concurrent character CAS with account ownership precondition;
- crash/TTL reclaim and displaced-character cleanup;
- reconnect grace CAS resume;
- admin online snapshot and revoke/kick ownership.

## Boundaries respected

Implementation changes remain in:

- `services/session-ownership/**`
- `tests/session-ownership/**`
- `workstreams/ws45/**`
- `.github/workflows/ws45-sessions.yml`

WS03, WS07, and WS08 branches/product implementation are not modified or imported. WS45 does not implement character stat mutation, inventory, combat, game packets, website API, admin frontend, `getCharacterState`, or `mutateOnlineCharacter`. Full `ADMIN_RUNTIME_AUTHORITY` is explicitly **not** claimed.
