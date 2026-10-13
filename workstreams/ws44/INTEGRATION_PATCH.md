# WS44 Integration Patch

## Branch

`ws44-server-status`

## Merge scope

Only these paths belong to WS44:

- `services/server-status-api/**`
- `tests/server-status-api/**`
- `workstreams/ws44/**`
- `.github/workflows/ws44-status.yml`

## Runtime integration

1. Provide an authoritative implementation of the health-source adapter contract (`listRealms()` and `getRealm(realmId)`).
2. Feed only realm health/status snapshots into `ServerStatusService`; do not expose the adapter directly to HTTP.
3. Keep `EXPOSE_ONLINE_PLAYER_COUNT` disabled unless product/privacy policy explicitly permits publishing the aggregate.
4. Route official website/launcher reads to:
   - `GET /v1/realms`
   - `GET /v1/realms/{realmId}`
5. Respect the API `Cache-Control` headers at the CDN/proxy layer.
6. Keep operational/internal health endpoints and infrastructure identifiers outside this public service contract.

## Expected adapter snapshot

Minimum fields per realm:

```js
{
  realmId,
  displayName,
  availability,          // online | offline | maintenance
  population,            // unknown | empty | low | medium | high | full
  serverVersion,
  lastHeartbeat,         // ISO timestamp or null
  minimumContentVersion
}
```

Optional public-capable aggregates: `onlinePlayerCount`, `uptimeSeconds`, `statusMessage`, and `capacity`.

## Compatibility notes

- Target patch is intentionally fixed to `1298` in the public model.
- WS44 does not require a database migration.
- WS44 does not require changes to WS03 or WS37.
- Queue/capacity fields are additive and optional, allowing future launchers to consume them without a breaking model change.
- Internal IP/port/secret/DB fields may exist inside an adapter snapshot but are discarded by the public projection.

## Verification

Run from repository root:

```bash
node --test tests/server-status-api/*.test.mjs
```

The WS44 workflow runs the same suite on Node.js 22.
