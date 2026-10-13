# WS45 — Session Ownership / Duplicate Login / Disconnect Arbitration

## Scope

WS45 owns only the server-side ownership decision for authenticated game sessions. It does not parse KO packets, open/close sockets, modify account data, or persist schema. WS03/gateway code remains the transport/coordinator and calls this domain through the exported service methods.

The protected resources are:

- `account:<accountId>` — at most one live game session may own an account.
- `character:<characterId>` — at most one live game session may own a character.

A character lease is granted only when the same session currently owns the related account lease.

## Policy split: 1298 compatibility vs modern safety

### 1298 compatibility target

The compatibility invariant is that the same account/character must not be concurrently usable by two game sessions. That is the externally observable behavior this domain preserves.

There is community/open-source Knight Online server precedent for forcing the old socket to fully disconnect when a new client connects with the same credentials. `co3moz/knightonline-js` explicitly describes waiting for the existing socket's disconnect/save path before allowing the replacement. This is useful compatibility evidence, but it is **not authoritative proof of the exact official 1298 server implementation**.

For that reason WS45 exposes two duplicate account policies:

- `reject-new` — the default. The existing live owner remains authoritative and the new login is rejected.
- `replace-old` — optional compatibility profile. Account ownership is transferred with CAS, the displaced session's remaining character leases are removed, and a disconnect request is emitted for the old session.

Character ownership never silently replaces another live character owner. A replacement account session must first displace/clean the old session and then explicitly acquire the character.

### Modern safety decisions

The following are deliberately modern server-safety mechanisms; they are not claims about the 1298 server internals:

- compare-and-set (CAS) ownership updates;
- expiring leases and heartbeat renewal;
- server-crash recovery by lease expiry;
- short reconnect grace state;
- idempotent disconnect and revoke operations;
- explicit GM kick and account-ban revoke interfaces;
- repository/lease-store abstraction instead of direct DB access;
- race retries with a bounded retry count;
- no socket manipulation inside the domain.

These mechanisms are intended to preserve classic observable behavior while preventing split-brain ownership in a multi-process/browser-era deployment.

## Lease model

Each stored lease contains:

- `scope`: `account` or `character`
- `key`: account ID or character ID
- `accountId`
- `characterId` (character scope only)
- `sessionId`
- `serverId`
- `state`: `active` or `grace`
- `generation`
- `acquiredAt`
- `heartbeatAt`
- `leaseUntil`
- `graceUntil`
- `version` (assigned by the store for CAS)

Expired rows are treated as stale even if the persistence adapter has not physically removed them yet.

## Lease-store contract

A production adapter must provide these asynchronous operations:

```text
get(scope, key) -> lease | null
compareAndSet(scope, key, expectedVersion, nextRecord | null)
  -> { ok, record }
listBySession(sessionId) -> lease[]
listAll() -> lease[]
```

`compareAndSet` is the critical primitive. It must be atomic across all game-server processes sharing the store. `expectedVersion = null` means "create only if no current row exists". `nextRecord = null` means conditional delete.

No database migration is included in WS45. A future SQL/Redis/etc. adapter may implement the contract with row versions, optimistic locking, transactions, Lua, or another truly atomic CAS primitive.

The bundled `InMemoryLeaseStore` exists for deterministic tests and local integration only; it is not a multi-process production store.

## Service interface

### `acquireAccount({ accountId, sessionId, serverId })`

Claims or renews an account lease. Under `reject-new`, a different live owner returns `ACCOUNT_IN_USE`. Under `replace-old`, CAS transfers the account and disconnect arbitration is emitted for the displaced session after its remaining leases are removed.

### `acquireCharacter({ accountId, characterId, sessionId, serverId })`

Requires the same session to hold an active, unexpired account lease. A live different owner returns `CHARACTER_IN_USE`.

### `heartbeat(sessionId)`

Extends all active leases currently owned by the session. Heartbeat does not revive expired or grace leases.

Recommended coordinator cadence: heartbeat significantly more often than `leaseMs` (for example around one third of the lease duration), with operational jitter handled outside this domain.

### `disconnect(sessionId, { useGrace, reason })`

- `useGrace: true` moves active leases to `grace` for `reconnectGraceMs`.
- `useGrace: false` conditionally deletes current leases immediately.
- Repeating the same grace disconnect is idempotent and does **not** extend the grace deadline.

Clean logout should normally use `useGrace: false`. Unexpected transport loss may use grace.

### `resumeGrace({ scope, key, previousSessionId, newSessionId, serverId })`

CAS-transfers a still-valid grace lease to a new authenticated session and returns it to `active`.

This method is an ownership primitive, **not authentication**. The caller must first prove that the new connection is authorized for the same account. A previous session ID by itself is not a credential.

Account and character leases are resumed separately. This preserves per-key atomic safety without pretending the abstract store supplies a cross-key transaction.

### `revokeAccount(accountId, { reason })`

Removes every lease belonging to the active account session and emits a disconnect request. Intended for account-ban/session-revocation integration.

This method does not decide whether an account is banned and does not prevent a later login by itself. The authoritative ban check remains in the account/auth layer; that layer should reject acquisition attempts before WS45 is called.

### `revokeSession(sessionId, { reason })`

GM/admin kick primitive. Deletes all current leases for the session and emits one disconnect request. Repeated calls are idempotent.

### `sweepExpired()`

Best-effort physical cleanup for stale rows. Safety does not depend on the sweep because every ownership read treats `leaseUntil <= now` as expired.

## Disconnect arbitration interface

WS45 accepts a dependency with:

```text
disconnectArbiter.requestDisconnect({ sessionId, reason, ...context })
```

The production integration may map this to WS03/gateway socket termination. WS45 never imports or modifies the protocol/session implementation.

Important ordering for `replace-old`:

1. CAS establishes the new account owner.
2. Remaining leases of the displaced session are conditionally removed.
3. A disconnect request for the old session is emitted.
4. The new session may then acquire its character.

At no point can both sessions own the same account lease or character lease in the shared store.

## Failure and race behavior

- Two simultaneous creates from an empty account slot: only one CAS can win; the loser retries and observes `ACCOUNT_IN_USE`.
- Stale owner: a new session may CAS-reclaim the expired version.
- Game server crash: no cleanup is required for safety; lack of heartbeat makes the lease stale after `leaseMs`.
- Heartbeat vs revoke: both use CAS. A stale heartbeat cannot overwrite a successful revoke/version change.
- Disconnect vs reconnect: grace transition/resume is CAS-protected; a repeated disconnect cannot extend an existing grace period.
- Sweep vs acquire: conditional delete cannot remove a newer version it did not read.

## Defaults

The implementation defaults are intentionally conservative and may be configured by the coordinator:

- duplicate policy: `reject-new`
- lease: `30s`
- reconnect grace: `10s`
- max CAS retries: `16`

These timings are modern operational defaults, not 1298 protocol constants.
