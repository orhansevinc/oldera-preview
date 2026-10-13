# OldKOWeb Runtime Configuration Standard

Status: WS35 contract v1  
Package: `packages/oldko-config`  
Scope: server-side services only

## 1. Principles

1. Every shared runtime setting uses the `OLDKO_` prefix.
2. Services call `loadConfig(process.env)` before opening sockets, accepting traffic, or connecting to a database.
3. Invalid configuration is a startup error. Services must not silently replace invalid values.
4. Production secrets are references, never literals committed to source control.
5. Configuration values are immutable after startup.
6. Service-specific settings that become cross-service concerns must be added to this contract instead of inventing conflicting names.

## 2. Environments

`OLDKO_ENV` is required and accepts only:

- `development`
- `test`
- `production`

`NODE_ENV` is not the contract key. Existing services may temporarily map `NODE_ENV` to `OLDKO_ENV` during integration, but new code should read only the typed config result.

## 3. Core service identity

| Variable | Required | Validation | Purpose |
|---|---:|---|---|
| `OLDKO_SERVICE_NAME` | yes | 2-63 lowercase letters/digits/hyphens | Stable service identity |
| `OLDKO_SERVICE_HOST` | no | hostname/IP | Bind host, default `127.0.0.1` |
| `OLDKO_SERVICE_PORT` | no | 1-65535 | Generic service port when needed |

## 4. Database contract

The central contract uses discrete fields instead of a committed connection string.

| Variable | When required |
|---|---|
| `OLDKO_DB_ENABLED` | optional, default `false` |
| `OLDKO_DB_DRIVER` | when DB enabled; `postgres` or `mssql` |
| `OLDKO_DB_HOST` | when DB enabled |
| `OLDKO_DB_PORT` | optional when DB enabled; defaults by driver (`5432` PostgreSQL, `1433` SQL Server) |
| `OLDKO_DB_NAME` | when DB enabled |
| `OLDKO_DB_USER` | when DB enabled |
| `OLDKO_DB_PASSWORD_REF` | when DB enabled unless a dev/test literal is supplied |
| `OLDKO_DB_PASSWORD` | development/test compatibility only; forbidden in production |

A consumer resolves `OLDKO_DB_PASSWORD_REF` through its deployment secret provider, then passes the resolved value directly to its DB client. The config package deliberately does not resolve secrets.

## 5. Gateway and KO server endpoints

`OLDKO_GATEWAY_ENABLED=true` requires both:

- `OLDKO_GATEWAY_AUTH_TARGET_URL`
- `OLDKO_GATEWAY_GAME_TARGET_URL`

Both must be valid `http://` or `https://` URLs without embedded credentials.

Raw auth/game host-port contracts are optional paired values:

- `OLDKO_AUTH_HOST` + `OLDKO_AUTH_PORT`
- `OLDKO_GAME_HOST` + `OLDKO_GAME_PORT`

If one member of a pair is set, the other becomes required. WS35 intentionally does not hard-code historical KO ports; the owning protocol workstream supplies the correct deployment values.

## 6. Admin API

`OLDKO_ADMIN_API_ENABLED=true` enables the admin API section.

- `OLDKO_ADMIN_API_HOST` — defaults to `127.0.0.1`
- `OLDKO_ADMIN_API_PORT` — defaults to `8787`
- `OLDKO_ADMIN_API_BASE_URL` — required when enabled
- `OLDKO_ADMIN_SESSION_SECRET_REF` — secret reference
- `OLDKO_GAME_COMMAND_TOKEN_REF` — secret reference for the command bridge when that bridge is used

Legacy literal keys `OLDKO_ADMIN_SESSION_SECRET` and `OLDKO_GAME_COMMAND_TOKEN` are accepted only in development/test and are rejected in production.

## 7. Observability

- `OLDKO_LOG_LEVEL`: `trace|debug|info|warn|error|fatal`, default `info`
- `OLDKO_LOG_JSON`: boolean, default `true`
- `OLDKO_METRICS_ENABLED`: boolean, default `false`
- `OLDKO_METRICS_HOST`: hostname/IP, default `127.0.0.1`
- `OLDKO_METRICS_PORT`: required when metrics are enabled
- `OLDKO_HEALTH_PATH`: default `/health`

This contract only defines configuration. It does not implement metrics, logging, or health endpoints.

## 8. Trusted origins and CORS

`OLDKO_TRUSTED_ORIGINS` is a comma-separated list of exact HTTP(S) origins, for example:

`https://admin.oldkoweb.com,https://play.oldkoweb.com`

Rules:

- paths, query strings, fragments, and embedded credentials are rejected;
- duplicate origins are removed;
- `*` is forbidden in production;
- `*` cannot be combined with `OLDKO_CORS_CREDENTIALS=true`.

`OLDKO_CORS_CREDENTIALS` defaults to `false`.

## 9. Timeouts

All values are milliseconds.

| Variable | Default | Allowed range |
|---|---:|---:|
| `OLDKO_STARTUP_TIMEOUT_MS` | 30000 | 100-300000 |
| `OLDKO_REQUEST_TIMEOUT_MS` | 15000 | 100-120000 |
| `OLDKO_DB_TIMEOUT_MS` | 10000 | 100-120000 |
| `OLDKO_GATEWAY_TIMEOUT_MS` | 10000 | 100-120000 |

## 10. Feature flags

Feature flags use `OLDKO_FF_<NAME>` and boolean values (`true`, `false`, `1`, `0`).

Example:

`OLDKO_FF_NEW_LOGIN_FLOW=false`

The typed result exposes that as `config.featureFlags.newLoginFlow`.

Flags are deployment controls, not authorization controls. A flag must never grant privileges that the authenticated identity does not already have.

## 11. Secret references

Accepted reference forms:

- `env://VARIABLE_NAME`
- `file:///absolute/path`
- `secret://provider/key`

The package validates syntax only. Resolution belongs to the deployment/runtime adapter so the core package stays cloud/vendor neutral.

Never commit:

- real passwords;
- private keys;
- access/session tokens;
- production connection strings;
- resolved secret values.

## 12. Secret redaction

Before logging configuration:

```js
import { loadConfig, redactConfig } from "@oldko/config";

const config = loadConfig(process.env);
logger.info({ config: redactConfig(config) }, "runtime configuration loaded");
```

`redactEnv()` masks secret-looking environment keys and all `*_REF` values. Validation errors never echo secret values.

## 13. Fail-fast behavior

`loadConfig()` throws `ConfigValidationError` with structured `issues`. Examples that fail startup:

- missing `OLDKO_ENV` or `OLDKO_SERVICE_NAME`;
- unknown `OLDKO_` variable typo;
- invalid port/range/timeout;
- malformed hostname or URL;
- gateway enabled without both targets;
- DB enabled without the required DB contract;
- production literal secret;
- wildcard production CORS origin;
- invalid feature flag boolean.

Consumers should let this exception terminate startup with a non-zero process exit code.

## 14. Legacy migration notes

Current code may use names such as `PORT`, `NODE_ENV`, `ADMIN_ORIGIN`, `KO_DB_*`, `SESSION_SECRET`, and `GAME_COMMAND_BRIDGE_*`. WS35 does not modify those services. The integration owner should map them once at service startup and then consume only `RuntimeConfig`.

The mapping plan is documented in `workstreams/ws35/INTEGRATION_PATCH.md`.
