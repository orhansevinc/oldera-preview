# WS07 repository matrix

All production adapters live under `services/oldko-data/src/adapters/`. They expose persistence semantics only; consumers keep gameplay validation, packet encoding, admin authorization and formulas.

| Consumer | Adapter | Persistence contract |
| --- | --- | --- |
| WS03 | `PgWs03SessionRepository` | async authenticate, nation, list/create/get character |
| WS03 | `PgAccountSessionRepository` | hashed session token create/read/touch/revoke |
| WS08 | `PgWs08AdminRepository` | exact WS08 `REQUIRED_METHODS`, shared-account player reads, offline versioned mutations, inventory/inn, sanctions, item trace/moderation, append-only audit, durable command outbox |
| WS14 | `PgWs14WorldRepository` | `getCharacterForWorld`, optimistic world-position/state save, reconnect snapshot |
| WS17 | `PgWs17ItemRepository` | exact `read(ownerId)` / `transact(ownerId, work)`, atomic equipment+inventory+inn, global serial uniqueness |
| WS22 | `PgEconomyTransactionManager` | one SERIALIZABLE boundary + deterministic advisory lock ordering |
| WS22 | `PgCoinRepository` | character coin get/set using caller transaction |
| WS22 | `PgTradeRepository` | create/get/save/find-active trade with DB active-participant exclusion |
| WS27 | `PgWs27ProgressionRepository` | load/save with optimistic progression version |
| WS45 | `PgWs45LeaseStore` | `get`, atomic `compareAndSet`, `listBySession`, `listAll` |
| WS46 | `PgWs46CharacterLifecycleRepository` | owned-character lookup + single delete UoW with lock/state/name/audit methods |
| WS26/WS22/integration | `PgOperationReceiptRepository` | same-transaction idempotency receipt for loot/economy-style mutations |

## WS08 exact mapping

`PgWs08AdminRepository` maps WS08's current `services/admin-api/src/repository.js` contract without creating a second player database:

- player/account identity: `oldko.accounts` + `oldko.characters`
- level/NP/coin and base attribute allocation: `oldko.character_stats`
- admin skill-allocation persistence: `oldko.character_skills`
- equipment/inventory: `oldko.character_items` + `oldko.inventory` + `oldko.item_instances`
- inn: `oldko.inn_storage` (WS17 keeps 196 authoritative slots; WS08's current HTTP shape exposes its declared 192 slots without truncating stored data)
- account/IP sanctions: `oldko.bans` + `oldko.ip_bans`
- item moderation/history: `oldko.admin_item_flags` + append-only `oldko.item_serial_events`
- audit: append-only `oldko.audit_log`
- game command bridge: durable `oldko.admin_command_outbox`
- runtime online state: active WS45 `oldko.session_leases`, with an injectable runtime authority resolver
- durable admin idempotency handoff: `oldko.admin_operation_receipts`

The KO admin attribute names map to the existing authoritative columns as `str -> str`, `hp -> sta`, `dex -> dex`, `int -> intel`, `mp -> cha`; current HP/MP resource values are not overwritten by an attribute-point edit.

## Admin identity/session persistence

`oldko.admin_actors` and `oldko.admin_sessions` provide a durable privileged identity/session surface. These identities are separate from player accounts by design. Browser labels (`ROOT OWNER`, display names, `actor`, `authority`) are never identity proof. WS08 currently owns authentication/session behavior and must explicitly wire these methods; WS07 does not edit WS08's `security.js` or `server.js`.

Likewise, WS08's current process-local `Idempotency-Key` map cannot become restart-safe without WS08 passing the key/request material through. WS07 supplies `reserveAdminOperation` / `completeAdminOperation`; until WS08 wires them, restart-stable HTTP idempotency remains an integration seam rather than a falsely claimed database guarantee.

## Online/CAS rule

Reads may report online only from runtime authority. Direct `updateCharacter`, `updateStats` and `updateSkills` reject an active character lease. Durable outbox rows capture expected character world/progression/item versions so the game-side bridge can perform CAS-aware application. Admin SQL does not overwrite a live game cache.

## WS03 integration note

WS03 consumes the existing direct persistence surfaces. `ws03-auth-session.js`, `ws14-world.js` and their database tables are unchanged by WS08 persistence work.

## WS14 snapshot note

`getCharacterForWorld` performs one joined character/stat/clan query and merges typed authoritative fields with persisted `world_state`. Live surrounding users/NPCs remain a world-runtime concern and are not queried from PostgreSQL by WS07.

## WS17 / WS22 shared transaction

`PgWs17ItemRepository.transact(ownerId, work, { tx })` accepts an optional caller-owned PostgreSQL transaction in addition to the two-argument WS17 contract. This allows a WS22 inventory port to participate in the same `PgEconomyTransactionManager` transaction as coins/trades without nested transactions.

## Query-count policy

- WS14 world snapshot: one bounded read query.
- WS17 owner snapshot: one identity query + one UNION placement query, independent of item count.
- WS08 item search/current-location queries use bounded UNION reads; admin list is capped at 5000 rows by the upstream contract.
- list/create writes may perform bounded per-slot writes (maximum 238 placements); no per-item read N+1 is used.
