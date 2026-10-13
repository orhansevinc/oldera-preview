# WS35 STATUS

Workstream: WS35  
Branch: `ws35-runtime-config`  
Scope: Runtime Configuration / Environment / Secrets Contract

## Completed

- Central `OLDKO_` environment naming standard
- `development` / `test` / `production` environment contract
- Typed ESM config package with TypeScript declarations
- Required/optional field validation
- Fail-fast startup validation
- Integer, range, hostname, port, URL, origin and timeout validation
- Database configuration contract for PostgreSQL and SQL Server
- Gateway auth/game target contract
- Raw auth/game host-port contract without hard-coded protocol ports
- Admin API configuration contract
- Observability configuration contract
- Trusted-origin and CORS rules
- Dynamic typed feature flags through `OLDKO_FF_*`
- Secret-reference syntax and production literal-secret rejection
- Secret redaction helpers
- Safe environment examples for development, test and production
- Machine-readable JSON Schema companion
- Node.js test suite
- Dedicated GitHub Actions workflow
- Integration instructions without modifying other services

## Safety / boundaries

No real password, token, private key, production connection string, DB migration, client/admin/site implementation, infrastructure implementation, or other service implementation was changed.

## Test command

`node --test tests/config/*.test.mjs`

Expected result: all tests pass on Node.js 20+.
