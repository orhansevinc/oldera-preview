# OldKOWeb TEST-ONLY Fixture Standard (WS49)

## 1. Scope

This standard exists only for automated development, integration and E2E tests. It MUST NOT be used as a production database seed, production bootstrap path, gameplay data source, admin data source, client data source, or credential source.

The reusable package is `packages/oldko-test-fixtures`. Scenario manifests live under `test-scenarios/manifests`.

## 2. Determinism contract

Every scenario has an explicit integer `seed`. Synthetic identities and serials are derived only from `(seed, namespace, key)` and therefore remain stable across runs, machines and services.

- Fixture identity prefix: `fx:ws49:<namespace>:<key>:<hash>`
- Fixture serial prefix: `fxserial:ws49:<namespace>:<key>:<hash>`
- No wall clock, UUID v4, Math.random, hostname or process-specific value is permitted in canonical fixture generation.
- A consumer may derive additional deterministic integers through `deterministicInt()` when its own storage adapter requires them, but such values remain test-only and MUST NOT be confused with real KO data IDs.

## 3. REAL 1298 DATA separation

WS49 never invents numeric IDs for real Knight Online data. Any real nation, class, item, NPC, mob, zone, spawn, inventory-capacity or character-slot-capacity dependency is represented as a logical `$catalog` marker.

Example:

```json
{ "$catalog": "zone.moradon" }
```

Without an adapter, materialization returns an explicit unresolved `WS31_CATALOG_REF` object. With `strictCatalog: true`, unresolved refs fail fast. When WS31 is available, consumers provide a `createCatalogAdapter(ref => ...)` adapter and receive `WS31_CATALOG` provenance together with the resolved value.

Logical refs are integration contracts, not claims that WS31 currently exposes these exact strings. The integration layer may map them to WS31 catalog queries/records. It MUST NOT replace them with guessed constants.

## 4. Credentials

`osevinc/osevinc` is an approved development/test-only fixture credential. It is available only through the `$testCredential` marker or `developmentCredential("osevinc", environment)`.

The package throws unless `environment` is exactly `test` or `development`. No production credential is created, stored or inferred.

## 5. Scenario manifest schema

Each category manifest has:

```text
schemaVersion: 1
testOnly: true
category: kebab-case
scenarios[]:
  id: ws49.<category>.<name>
  seed: unique integer
  description: human-readable intent
  payload: declarative test graph
```

Supported marker objects inside `payload`:

- `{ "$fixtureId": ["namespace", "key"] }`
- `{ "$serial": ["namespace", "key"] }`
- `{ "$catalog": "logical.catalog.ref" }`
- `{ "$testCredential": "osevinc" }`
- `{ "$randomInt": ["scope", min, max] }`

Raw numeric fields whose key ends in `Id` are rejected by validation. Use `$fixtureId` for synthetic identities or `$catalog` for real 1298 identities.

## 6. Scenario catalog

Canonical manifests cover 27 scenarios:

- ACCOUNT (4): normal player, banned account, IP-banned fixture, duplicate login.
- CHARACTER (7): empty account, one character, full character slots, Karus, El Morad, different classes, dead/alive.
- ITEM (5): empty inventory, full inventory, stackable, non-stackable, duplicate-serial negative test.
- SOCIAL (4): friends, blocked, party, clan.
- WORLD (4): Moradon spawn, movement, NPC interaction, mob combat.
- ECONOMY (3): buy/sell, trade rollback, inn transfer.

## 7. Consumer rules

1. Load a canonical manifest and validate it before use.
2. Materialize only in a development/test process.
3. Supply a WS31 adapter for tests that require real 1298 IDs; use `strictCatalog: true` in integration CI once WS31 is wired.
4. Translate fixture graphs into a service-specific persistence/API shape in the consumer test adapter, not in production code.
5. Never copy fixture literals into migrations or product defaults.
6. Negative fixtures (for example duplicate serial) must be asserted as rejection paths and must never be promoted to reusable happy-path seeds.

## 8. Versioning

Breaking changes to marker semantics or manifest shape require a `schemaVersion` bump. Adding a new scenario under schema version 1 is non-breaking if existing IDs, seeds and marker behavior remain stable.
