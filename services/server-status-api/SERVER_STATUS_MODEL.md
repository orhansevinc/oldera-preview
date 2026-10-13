# OldKOWeb Public Server Status Model

WS44 owns a read-only public projection for the official site and launcher. It does not own game-session health, networking, infrastructure, persistence, or the authoritative heartbeat producer.

## Public realm model

| Field | Type | Notes |
| --- | --- | --- |
| `realmId` | string | Stable public ID, lowercase slug. |
| `displayName` | string | Human-readable realm name. |
| `availability` | enum | `online`, `offline`, `maintenance`. |
| `online` | boolean | Derived from `availability === online`. |
| `maintenance` | boolean | Derived from `availability === maintenance`. |
| `population` | enum | `unknown`, `empty`, `low`, `medium`, `high`, `full`. |
| `onlinePlayerCount` | integer, optional | Privacy-safe aggregate only; omitted by default unless explicitly enabled. |
| `serverVersion` | string | Public server build/version label. |
| `targetPatch` | string | Always `1298` for this service contract. |
| `lastHeartbeat` | ISO-8601 or null | Timestamp from the authoritative health source. |
| `uptimeSeconds` | integer, optional | May be omitted when the source cannot provide trustworthy uptime. |
| `statusMessage` | string, optional | Public announcement/status message, max 240 chars. |
| `client.minimumContentVersion` | string | Minimum client content version accepted by this realm. |
| `capacity.queueSupported` | boolean | Future-compatible queue interface. |
| `capacity.maxPlayers` | integer, optional | Public capacity if policy permits disclosure. |
| `capacity.queueDepth` | integer, optional | Only emitted when queue support is enabled and a public aggregate exists. |

## Health source adapter

A health source implements:

```js
await healthSource.listRealms();      // -> RealmHealthSnapshot[]
await healthSource.getRealm(realmId); // -> RealmHealthSnapshot | null
```

The internal snapshot may contain operational fields needed by an adapter. The HTTP layer never serializes the adapter object directly. `ServerStatusService` validates every snapshot and constructs a new allow-listed public object.

This boundary intentionally permits future adapters for a heartbeat bus, service discovery, or another authoritative source without modifying WS03 or infrastructure code.

## Privacy and security boundary

Public responses MUST NOT contain internal IP addresses, ports, hostnames, database identifiers, credentials, secrets, node IDs, admin notes, or raw adapter metadata. Tests seed these fields deliberately and verify they are absent from serialized output.

`onlinePlayerCount` is disabled by default. If product policy enables it, it remains a realm-level aggregate and never includes character/account/session identifiers.

## Cache contract

- `GET/HEAD /v1/realms`: `public, max-age=15, stale-while-revalidate=30`
- `GET/HEAD /v1/realms/{realmId}`: `public, max-age=10, stale-while-revalidate=20`
- `GET/HEAD /openapi.json`: `public, max-age=300`
- `/healthz`, errors, and rejected write methods: `no-store`

These short public TTLs allow CDN/browser reuse without making status stale for long periods. A future integration may add validators such as ETag without changing the read model.

## Read-only guarantee

Only `GET` and `HEAD` are accepted. `POST`, `PUT`, `PATCH`, `DELETE`, and other methods receive `405 METHOD_NOT_ALLOWED`. WS44 performs no database migration and has no public mutation endpoint.
