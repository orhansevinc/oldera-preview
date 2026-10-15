# WS23 Quest Model

## Scope

This module is a server-side quest/event domain for OldKO's 1.298 target. It intentionally does **not** define client packet opcodes, official NPC IDs, official quest IDs, or database migrations. Those must come from verified 1.298 evidence and the owning integration workstreams.

The design is data-driven and sandboxed. Quest data is JSON. Event scripts use a fixed instruction allowlist; there is no `eval`, dynamic `Function`, shell command, process spawning, module loading from quest data, or arbitrary filesystem/network access.

## 1.298 evidence boundary

Open-KO explicitly targets 1.298/9 compatibility. Its EVT support tracking documents 1.298-era concepts including level/class/nation checks, dialogue/select-message flow, event chaining, item/Noah rewards, saved event state, EXP changes, and return/termination. This WS23 implementation uses those concepts only to justify the **shape of the abstraction**. It does not copy or guess numeric EVT opcodes or packet layouts.

References:
- https://github.com/Open-KO/KnightOnline
- https://github.com/Open-KO/KnightOnline/issues/260

Anything not verified at the protocol/data layer remains an adapter concern rather than being presented as authentic 1.298 behavior.

## Quest definition

A quest definition has:

- `id`: opaque string or non-negative integer. No encoding assumption.
- `name`: server/operator-facing label.
- `repeatable`: explicit boolean.
- `allowAbandon`: explicit boolean. This is a capability flag, not a claim that every 1.298 quest can be abandoned.
- `requirements`: optional `minLevel`, `maxLevel`, `classes`, `nations`, `prerequisites`.
- `objectives`: deterministic counters keyed by an application-defined `eventType` and optional `targetId`.
- `rewards`: `xp`, `coins`, and `items[]` only. The service delegates actual grants through `RewardGateway`.
- `dialogue`: optional keys for `available`, `active`, `ready`, `completed`, and `ineligible` states.

Class, nation, item, NPC and quest IDs are opaque. The core does not encode guessed 1.298 constants.

## Quest state

Per character + quest:

- `status`: `not_started | active | completed`
- `run`: monotonically increases on each acceptance
- `completionCount`: used for prerequisites and repeatable quests
- `objectiveProgress`: objective counter map
- `revision`: repository mutation revision

A non-repeatable quest cannot be accepted after one completion. A repeatable quest can start a new run after completion. Abandon returns an active quest to `not_started`, clears current objective progress, and preserves historical completion count.

## Repository contract

`QuestStateRepository` exposes:

- `get(characterId, questId)`
- `mutate(characterId, questId, mutator)`

`mutate` **must be atomic per character+quest key**. The bundled in-memory repository serializes mutations and exists for tests/dev only. Production persistence belongs to the database workstream and should provide equivalent atomicity without changing this domain model.

## Reward contract

`RewardGateway.grantBundle(request)` receives:

- `idempotencyKey`
- `characterId`
- `questId`
- `rewards: { xp, coins, items[] }`

The adapter must be idempotent by `idempotencyKey`. WS23 deliberately does not import WS17 or WS22. Item, coin and XP mutation remain owned by their respective domains. If a grant throws, quest completion is not committed by the repository mutation; retries reuse the same idempotency key.

## NPC event routing

`NpcEventRouter` maps `(npcId, action)` to an event definition. The `action` value is intentionally application-defined. A verified protocol/NPC adapter can translate a 1.298 interaction or menu selection into these route keys later.

Event scripts support only:

- `dialogue`
- `quest_view`
- `quest_accept`
- `quest_complete`
- `quest_abandon`
- `goto_if_state`
- `end`

Scripts have an instruction budget (default 64). Loops can therefore never run indefinitely. Unknown instructions are rejected before execution.

Direct `give_item`, `give_coin`, `give_xp`, OS commands, raw SQL and general-purpose expressions are intentionally absent. Rewards can only be emitted by completing a validated quest definition.

## Progress events

Gameplay domains call `recordProgress(characterId, questId, { type, targetId?, count? })` with already-authorized server facts. WS23 never trusts client-authored progress directly. Counters are capped at each objective's `requiredCount` and repository mutation is atomic, so concurrent matching events cannot over-increment the stored count.

## Fixture data

`quest-data/fixtures/*` is explicitly synthetic test data. It is not asserted to be an official 1.298 quest/NPC/item set. Fixture IDs are strings for that reason.
