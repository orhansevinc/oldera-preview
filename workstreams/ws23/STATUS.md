# WS23 Status

## Branch

`ws23-quest-events` from `main`.

## Completed

- Data-driven quest definition model.
- Prerequisites plus level/class/nation requirements using opaque IDs.
- Quest lifecycle: accept, progress, complete, explicit abandon capability, repeatable/non-repeatable handling.
- Dialogue state resolution (`available`, `active`, `ready`, `completed`, `ineligible`).
- Atomic quest-state repository interface and serialized in-memory implementation.
- Reward gateway with item/coin/XP bundle and idempotency key contract.
- NPC `(npcId, action)` event routing.
- Deterministic sandboxed event interpreter with fixed op allowlist and instruction budget.
- Synthetic fixture quests/events/routes under `quest-data/fixtures`.
- Node built-in tests covering requirements, lifecycle, rewards, concurrency, routing, unsafe op rejection and loop budget.
- Dedicated GitHub Actions workflow.

## 1.298 research boundary

Open-KO describes itself as an old-school Knight Online implementation specifically targeting 1.298/9. Its EVT support issue documents authentic 1.298-era concepts such as level/class/nation checks, dialogue/select-message, event chaining, item/Noah reward operations, saved event state, EXP change and termination. WS23 uses this only as evidence for domain boundaries and does not guess wire opcodes, packet layouts, official quest IDs, or official NPC mappings.

Sources:
- https://github.com/Open-KO/KnightOnline
- https://github.com/Open-KO/KnightOnline/issues/260

## Safety

Quest data cannot execute OS commands or general-purpose JavaScript. There is no `eval`, `Function`, shell/process API, raw SQL, dynamic require, direct filesystem access from scripts, or arbitrary network call. Unknown event operations fail validation. Reward side effects only occur through the injected reward gateway when a validated quest completes.

## Verification

Local verification on Node.js 22: `node --test tests/ko1298-quests/*.test.js` -> 9 passed, 0 failed.

## Integration state

WS16/WS17/WS22 branches were not modified. Concrete adapters are documented in `INTEGRATION_PATCH.md` and should be wired only after their public interfaces exist.
