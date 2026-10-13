# WS35 Integration Patch

WS35 intentionally does not edit consumer services. Apply the following pattern when each service is integrated.

## 1. Import once at startup

```js
import { loadConfig, redactConfig } from "../../packages/oldko-config/src/index.js";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
```

Do this before opening listeners or connecting to external systems.

## 2. Legacy admin API mapping

The current `server/.env.example` uses legacy keys. During migration, deployment configuration should rename them as follows:

| Legacy key | Central contract |
|---|---|
| `NODE_ENV` | `OLDKO_ENV` |
| `PORT` | `OLDKO_ADMIN_API_PORT` or `OLDKO_SERVICE_PORT` |
| `ADMIN_ORIGIN` | include in `OLDKO_TRUSTED_ORIGINS` |
| `KO_DB_ENABLED` | `OLDKO_DB_ENABLED` |
| `KO_DB_HOST` | `OLDKO_DB_HOST` |
| `KO_DB_PORT` | `OLDKO_DB_PORT` |
| `KO_DB_NAME` | `OLDKO_DB_NAME` |
| `KO_DB_USER` | `OLDKO_DB_USER` |
| `KO_DB_PASSWORD` | `OLDKO_DB_PASSWORD_REF` in production |
| `SESSION_SECRET` | `OLDKO_ADMIN_SESSION_SECRET_REF` |
| `GAME_COMMAND_BRIDGE_URL` | service-specific use of gateway/command target after owner alignment |
| `GAME_COMMAND_BRIDGE_TOKEN` | `OLDKO_GAME_COMMAND_TOKEN_REF` |

The table-name overrides currently present in the admin server are domain-specific DB adapter settings, not part of WS35's cross-service runtime contract. Keep them with the DB adapter until a shared schema owner explicitly centralizes them.

## 3. Secret resolution adapter

`@oldko/config` returns secret sources but does not resolve them.

Example deployment adapter behavior:

- `env://OLDKO_DB_PASSWORD_VALUE` -> read that runtime environment variable;
- `file:///run/secrets/oldko-db-password` -> read the mounted secret file;
- `secret://provider/key` -> ask the deployment's secret provider.

Never log the resolved value. The adapter should replace the source only in memory immediately before creating the client connection.

## 4. Logging

```js
logger.info(
  { runtimeConfig: redactConfig(config) },
  "runtime configuration validated"
);
```

Do not serialize `process.env` directly.

## 5. Recommended integration order

1. Admin API
2. Public Account API
3. Gateway
4. Auth/Game protocol service
5. Data/persistence service
6. Remaining domain services as they gain executable hosts

Each consumer should remove its duplicate parser only after its own tests prove parity.

## 6. Required integration checks

For every consumer:

- missing required config exits non-zero before listening;
- invalid port/URL/timeout exits non-zero;
- production literal secrets fail;
- startup logs contain redacted config only;
- CORS reads `config.cors`;
- network targets read `config.gateway` / `config.network`;
- DB clients read `config.database`;
- no production secret is committed to Git.

## 7. No automatic behavior change

Merging WS35 alone changes no running service because this branch deliberately contains only the shared contract, documentation, tests, and CI. Consumer workstreams must opt in via their own allowed files.
