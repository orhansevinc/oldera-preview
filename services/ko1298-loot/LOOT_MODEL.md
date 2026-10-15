# WS26 Loot Model

## Two explicit models

WS26 now keeps the old generic weighted `LootService` for fixture/back-compat tests and adds a separate production path: `ProductionLootService` + `Verified1298DropTableAdapter`.

Synthetic weighted data must not be represented as historical 1298 data. Production accepts only tables carrying `model: 'ko1298-verified'` and pinned `verified-1298` provenance.

## Verified 1298 generation

A monster maps through `K_MONSTER.sItem` to `K_MONSTER_ITEM.sIndex`; monster money comes from `K_MONSTER.iMoney`.

The verified runtime model reproduces the source-backed behavior used by `CNpc::GiveNpcHaveItem` / `GetItemGroupNumber`:
- five item slots roll independently on a 10,000-point scale;
- slot 0 uses `ItemProdution` when the code is `< 100`, otherwise `MAKE_ITEM_GROUP`;
- slot 1 uses `MAKE_ITEM_GROUP`;
- slots 2..4 are direct item IDs;
- item-group selection uses the source 30-slot modulo rule;
- direct arrow-range drops use quantity 20; other direct items use quantity 1;
- coin uses 70..100 percent of base monster money with the legacy cap behavior.

The exact `ItemProdution` algorithm is deliberately **not guessed**. A verified resolver is required for those rows.

## Ground loot record

Every generated reward becomes a distinct immutable ground record containing:
- unique `lootId`;
- source death/mob/template/killer IDs;
- table ID and provenance;
- authoritative death zone and position;
- reward payload;
- owner character IDs;
- `createdAt`, optional verified `publicAt`, `expiresAt`;
- `state` and `claimed` marker.

No-drop is a durable death outcome too; it is persisted so a repeated death event cannot reroll after restart.

## Pickup authority

Production pickup takes only `lootId`, `characterId`, and `requestId` as packet-level identity inputs. Client-provided zone/coordinates are not authoritative.

The service obtains alive/world-ready/connected/zone/position from `playerState`, uses the WS15 distance adapter, checks ownership, and rechecks player state inside the durable claim transaction.

WS17 remains authoritative for inventory capacity, stack merging, serial generation and item mutation. WS22 remains authoritative for coin balance semantics. WS07 owns durable transaction rollback.

## Claim / anti-dupe invariants

In-process state machine: `available -> claiming -> claimed/deleted`.

Durable invariants:
- one persisted death outcome per `eventId`;
- stable death transaction `loot-death:<eventId>`;
- stable claim transaction `loot-claim:<lootId>`;
- one persisted claim per `lootId`;
- one replay-key transition per pickup request;
- serial uniqueness delegated to WS17/DB and guarded before grant;
- ground loot is removed only after successful transaction;
- failed grants/persistence restore transient claimability after rollback;
- despawn is persisted under `loot-despawn:<lootId>` before removal;
- spawn/claim/despawn audit events are emitted.

## Ownership / party

Ownership and party distribution are ports. WS26 does not embed round-robin/random logic without verified 1298 evidence.

A `publicAfterMs` policy is rejected unless the ownership adapter explicitly marks it `publicAfterVerified: true`.

## Regression provenance

`world-data/drops/verified1298.sample.json` is a small source-backed regression sample, not a complete production catalog. See `workstreams/ws26/DROP_PROVENANCE.md` for pinned source commits and unresolved rules.
