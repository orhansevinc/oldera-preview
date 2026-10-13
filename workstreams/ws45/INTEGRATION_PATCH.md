# WS45 Integration Patch

WS45 deliberately does not modify WS03, WS07, WS13, gateway, client, admin, or site code. Integration is a call-site patch to be applied by the owning workstreams after merge planning.

## Exports

```js
const {
  SessionOwnershipService,
  InMemoryLeaseStore,
  DUPLICATE_LOGIN_POLICY,
  LEASE_SCOPE,
  RESULT,
} = require('services/session-ownership');
```

Use a shared production lease-store adapter; do not use `InMemoryLeaseStore` when multiple game-server processes can serve the same realm.

## Login/session coordinator wiring

1. After credentials/account status are validated, but before entering game state:

```js
const claim = await ownership.acquireAccount({ accountId, sessionId, serverId });
if (!claim.ok) {
  // Map ACCOUNT_IN_USE to WS03's existing/proper KO login failure response.
  return rejectGameLogin(claim.code);
}
```

2. After character selection is validated and before spawning/loading the character into the world:

```js
const claim = await ownership.acquireCharacter({
  accountId,
  characterId,
  sessionId,
  serverId,
});
if (!claim.ok) return rejectCharacterLogin(claim.code);
```

3. While the session is authoritative, call:

```js
await ownership.heartbeat(sessionId);
```

Coordinator cadence should be comfortably below `leaseMs`; a starting operational rule is approximately `leaseMs / 3`.

4. On clean logout:

```js
await ownership.disconnect(sessionId, {
  useGrace: false,
  reason: 'CLIENT_LOGOUT',
});
```

5. On unexpected TCP/WebSocket/browser loss where reconnect continuity is desired:

```js
await ownership.disconnect(sessionId, {
  useGrace: true,
  reason: 'TRANSPORT_LOST',
});
```

6. After the reconnecting client has been authenticated as the same account, resume account and optional character lease individually:

```js
await ownership.resumeGrace({
  scope: LEASE_SCOPE.ACCOUNT,
  key: accountId,
  previousSessionId,
  newSessionId,
  serverId,
});

await ownership.resumeGrace({
  scope: LEASE_SCOPE.CHARACTER,
  key: characterId,
  previousSessionId,
  newSessionId,
  serverId,
});
```

Do not use `previousSessionId` as proof of identity. Authentication/session continuity remains WS03/account-auth responsibility.

## Duplicate policy selection

Recommended production default:

```js
duplicateLoginPolicy: DUPLICATE_LOGIN_POLICY.REJECT_NEW
```

If integration testing establishes that the target 1298-compatible flow must replace the old connection, configure `REPLACE_OLD`. The service then requests old-session termination through `disconnectArbiter`; it does not directly touch the socket.

## Account ban integration (WS13/auth owner)

When a ban becomes effective:

```js
await ownership.revokeAccount(accountId, { reason: 'ACCOUNT_BANNED' });
```

The auth/account layer must also keep the ban authoritative so a later acquire attempt is not accepted after the lease is gone.

## GM command integration

The GM command owner may call:

```js
await ownership.revokeSession(sessionId, { reason: 'GM_KICK' });
```

The disconnect arbiter should forward that result to the actual game-session transport owner.

## Persistence adapter requirements

No migration is part of WS45. The adapter introduced by the DB/infrastructure owner must guarantee atomic CAS on `(scope, key)` and share state across all relevant game-server instances.

Required methods:

```text
get
compareAndSet
listBySession
listAll
```

A DB schema/index design is intentionally left to the schema-owning workstream.

## Error mapping left to WS03

WS45 returns semantic domain codes (`ACCOUNT_IN_USE`, `CHARACTER_IN_USE`, `ACCOUNT_NOT_OWNED`, etc.). It does not invent packet opcodes or numeric KO error codes. WS03 should map these to the verified 1298 protocol response once that mapping is known.
