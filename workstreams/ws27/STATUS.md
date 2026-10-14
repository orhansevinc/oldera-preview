# WS27 Status

## Identity

- Workstream: WS27
- Branch: `ws27-progression`
- Scope: XP / Level / Death / Respawn / progression persistence contract
- State: PRODUCTION RUNTIME CONTRACT COMPLETE; production data adapters still required where marked UNKNOWN.

## XP

- [x] `bigint` XP accounting; unsafe numeric input rejected.
- [x] Exact XP thresholds remain `LevelTablePort`; no invented curve.
- [x] Verified max level 80 enforced from pinned source.
- [x] Source-faithful one-level-per-`ExpChange` event semantics; previous multi-level loop removed.
- [x] Carried overflow below max level is preserved for later XP events.
- [x] Max-level saturation / overflow discard event.
- [x] Negative/invalid kill reward rejection.
- [x] Stable kill-event idempotency / duplicate reward replay protection.
- [x] `KillRewardPort` separates mob-death identity from the still-unknown XP dataset.
- [x] Party allocation remains a verified-data adapter.

## Level

- [x] `progression.level_up`, `level_down`, `level_mutated` events.
- [x] Verified conditional +3 stat / +2 skill point eligibility helper.
- [x] `LevelRewardPort` for character/stat representation mutation.
- [x] `VitalsPort` for source-required HP/MP/ability recalculation.
- [x] `progression.client_sync_required` contract.
- [x] Persistence snapshots carry resulting level/XP/version/replay state.

## Death

- [x] `alive -> dead` single transition.
- [x] Duplicate death ignored; no duplicate XP loss.
- [x] Source-verified 1% and 5% NPC death-loss divisors supported only when combat/zone adapter identifies the branch.
- [x] No default guessed death-loss branch.
- [x] Level < 6 negative death XP suppressed.
- [x] Nation/loyalty remains owner handoff (`NationPointPort`).
- [x] Item loss not implemented / not guessed.

## Respawn

- [x] Explicit `dead -> respawn_requested -> alive` state machine.
- [x] Authoritative respawn location via `RespawnPointPort` (WS14/world boundary).
- [x] Normal HP restore-to-max rule; MP preserved unless a separately verified resurrection adapter says otherwise.
- [x] Movement baseline reset port.
- [x] Verified 10-second respawn blink/immunity.
- [x] Dead movement/combat guard; blinking combat guard.
- [x] Repeated respawn request idempotency.
- [x] Dead/pending-respawn state survives persistence snapshot + reconnect restore.

## Persistence

- [x] Snapshot: level / XP / death / pending respawn / immunity / version / replay ledger.
- [x] `expectedVersion -> nextVersion` optimistic concurrency/CAS envelope.
- [x] Event replay/idempotency ledger persisted in snapshot contract.
- [x] Stale version rejection.
- [ ] Concrete WS07 compare-and-swap storage wiring: integration adapter required; no DB migration guessed in WS27.

## Test

- [x] 27 deterministic Node tests.
- [x] XP threshold boundary.
- [x] Single-event one-level boundary / carried mass XP.
- [x] Max level / overflow.
- [x] Invalid/negative rewards.
- [x] Stat/skill eligibility.
- [x] Duplicate kill reward.
- [x] Party allocation validation.
- [x] 1% / 5% / unknown death-loss branches.
- [x] Death once / duplicate death.
- [x] Respawn request/completion/repeat.
- [x] Dead + blink gameplay guards.
- [x] Disconnect/reconnect dead-state restore.
- [x] Optimistic concurrency conflict.
- [x] 1000 deterministic kill progression simulation.

## CI

Existing `.github/workflows/ws27-progression.yml` runs `node --test tests/ko1298-progression/*.test.js` on WS27 changes and remains valid.

## UNKNOWN

- Exact 1298 `LEVEL_UP.RequiredExp` row dataset is not present in current WS31 catalog.
- Exact mob -> XP reward dataset/mapping is not present in current verified catalog.
- Exact party XP formula remains unverified.
- Complete zone/combat selection map for the verified 1% vs 5% NPC death-loss branches remains integration-owned.
- Item loss remains unverified and unimplemented.
