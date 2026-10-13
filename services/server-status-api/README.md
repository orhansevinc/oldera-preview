# OldKOWeb Server Status API

Public read-only realm directory for target patch 1298.

## Endpoints

- `GET /healthz`
- `GET /v1/realms`
- `GET /v1/realms/{realmId}`
- `GET /openapi.json`
- `HEAD` is supported for the same paths.

The service is dependency-free on Node.js 22+. The default executable starts with an empty in-memory health source; production integration must supply an authoritative adapter rather than inventing status.

Run tests from the repository root:

```bash
node --test tests/server-status-api/*.test.mjs
```
