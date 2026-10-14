# WS07 database security runbook

## Credentials and passwords

- Accounts store only `password_hash`; WS07 uses salted `scrypt` and constant-time comparison.
- Session tokens are stored only as `bytea` hashes.
- `DATABASE_URL`, TLS settings and seed passwords come from runtime secret/configuration; no production secret belongs in the repository.
- `seed:dev` aborts when `OLDKO_ENV`/`NODE_ENV` is `production` and requires `OLDKO_DEV_SEED_PASSWORD`.

## SQL injection

All user/domain values are bound parameters. Dynamic SQL is restricted to fixed, code-owned fragments (transaction isolation allow-list and known persistence table/container branches). Consumer-supplied table names or SQL snippets are not accepted.

## Least privilege

Recommended production roles (passwords/identity supplied by the platform, not SQL files):

```sql
CREATE ROLE oldko_migrator NOINHERIT;
CREATE ROLE oldko_runtime NOINHERIT;
REVOKE ALL ON SCHEMA oldko FROM PUBLIC;
GRANT USAGE ON SCHEMA oldko TO oldko_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA oldko TO oldko_runtime;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA oldko TO oldko_runtime;
```

`oldko_migrator` should own/apply migrations during deployment and must not be the long-running game-server credential. The runtime role should not receive database-creation, superuser, replication or role-management privileges. Production hard-account purge requires a separately reviewed maintenance transaction that sets `oldko.allow_hard_delete` locally; routine runtime code should never set it.

## Audit

`audit_log` is append-only at the DB layer. Administrative/security writes should include actor, request ID and source IP when available. `persistence_operations` is transaction/idempotency metadata and is not a replacement for security audit events.
