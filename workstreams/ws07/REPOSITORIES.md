# WS07 repository matrix

All production adapters live under `services/oldko-data/src/adapters/`. They expose persistence semantics only; consumers keep gameplay validation, packet encoding and formulas.

| Consumer | Adapter | Persistence contract |
| --- | --- | --- |
| WS03 | `PgWs03SessionRepository` | async authenticate, nation, list/create/get character |
| WS03 | `PgAccountSessionRepository` | hashed session token create/read/touch/revoke |
| WS14 | `PgWs14WorldRepository` | `getCharacterForWorld`, optimistic world-position/state save, reconnect snapshot |
| WS17 | `PgWs17ItemRepository` | exact `read(ownerId)` / `transact(ownerId, work)`, atomic equipment+inventory+inn, global serial uniqueness |
| WS22 | `PgEconomyTransactionManager` | one SERIALIZABLE boundary + deterministic advisory lock ordering |
| WS22 | `PgCoinRepository` | character coin get/set using caller transaction |
| WS22 | `PgTradeRepository` | create/get/save/find-active trade with DB active-participant exclusion |
| WS27 | `PgWs27ProgressionRepository` | load/save with optimistic progression version |
| WS45 | `PgWs45LeaseStore` | `get`, atomic `compareAndSet`, `listBySession`, `listAll` |
| WS46 | `PgWs46CharacterLifecycleRepository` | owned-character lookup + single delete UoW with lock/state/name/audit methods |
| WS26/WS22/integration | `PgOperationReceiptRepository` | same-transaction idempotency receipt for loot/economy-style mutations |

## WS03 integration note

The current WS03 `MemoryRepository` call sites invoke `authenticate/getNation/setNation/listCharacters/createCharacter/getCharacter` synchronously. A real PostgreSQL repository is necessarily asynchronous. WS07 therefore **does not patch WS03**; final integration must make those repository call sites await the existing semantic operations before swapping in `PgWs03SessionRepository`. This is the remaining composition seam, not a persistence deficiency.

## WS14 snapshot note

`getCharacterForWorld` performs one joined character/stat/clan query and merges typed authoritative fields with persisted `world_state`. Live surrounding users/NPCs remain a world-runtime concern and are not queried from PostgreSQL by WS07.

## WS17 / WS22 shared transaction

`PgWs17ItemRepository.transact(ownerId, work, { tx })` accepts an optional caller-owned PostgreSQL transaction in addition to the two-argument WS17 contract. This allows a WS22 inventory port to participate in the same `PgEconomyTransactionManager` transaction as coins/trades without nested transactions.

## Query-count policy

- WS14 world snapshot: one bounded read query.
- WS17 owner snapshot: one identity query + one UNION placement query, independent of item count.
- list/create writes may perform bounded per-slot writes (maximum 238 placements); no per-item read N+1 is used.
