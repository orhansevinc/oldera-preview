WS03

# STATUS — verified KO1298 combat ingress wired to WS19

State: **PASS / CHILD-CANDIDATE READY WITH EXPLICIT DOWNSTREAM BLOCKERS**
Branch: `ws03-ko1298-session`
Implementation/composition head: `5bb6e6ec6769357669a84be35b197574e23ddea0`
Canonical verification workflow: `WS03 KO1298 Session`
Implementation GREEN run: **#9** / run id `38628385376`

## Immutable task-start provider snapshot

This combat task resolves provider heads once and does not silently upgrade them during composition:

- WS11 `944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS19 `28eb4f38753ffbc54c60abbd2a32832301284c06`
- WS25 `13c9bafe287b250d56b52f19e97a02e7ef18e6e5`
- WS15 `ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d`
- WS17 `fbfc13f9c123ebeb6dd38c32fc95ef26d917a777`

The dependency manifest and CI now enforce `task-pinned-provider-shas-no-silent-upgrade`. Provider branch refs are fetched only to make pinned commit objects reachable; composition archives the pinned SHAs, never a newly resolved branch tip.

## Combat ingress

### WIZ_ATTACK 0x08

WS11 VERIFIED KO1298 C2S normal attack is now bound to WS19 and accepted only in `WORLD_READY`.

The strict inbound decoder consumes the exact verified 8-byte packet including opcode:

- attack type `u8`, required normal-attack value `1`;
- target runtime ID `i16le`;
- client interval `i16le` / 0.01 scale;
- client distance `i16le` / 0.1 scale.

Client interval/distance are retained only as non-authoritative observations. Source identity is never taken from the packet. `sourceEntityId` and `sourceCharacterId` come from the authenticated WS03 session actor context. Every request receives server-side ingress/dedupe metadata.

### WIZ_MAGIC_PROCESS 0x31

WS11 VERIFIED 22-byte C2S generic form is now bound to WS19 and accepted only in `WORLD_READY`.

Commands 1..6 are preserved source-faithfully:

1. CASTING
2. FLYING
3. EFFECTING
4. FAIL
5. DURATION_EXPIRED / end
6. CANCEL

The packet's source ID is retained only as an untrusted client claim. Session identity is authoritative. Client data fields are never promoted to damage/range/cooldown/resource/HP authority. EFFECTING can reach the WS19 skill domain; non-effect lifecycle commands remain typed semantic lifecycle operations and do not fabricate an effect.

## Real provider composition evidence

Run `38628385376` materialized the exact pinned providers read-only and passed both composition contracts.

The combat composition uses:

- WS15 real `MovementService` for authoritative player world position;
- WS17 real `ItemDomainService.getCombatItemSnapshot()` for equipment snapshot acquisition;
- WS19 real `CombatService`, `SkillService`, world/equipment/player combat ports;
- WS25 real `MobVisibilityService` for signed-i16-band runtime mob identity and mob world/HP snapshot;
- WS11 pinned `gameplay-authority.json` to assert the inbound opcodes remain VERIFIED.

WS25 correctly rejects a real-data mob without authoritative terrain-height resolution. The composition harness therefore supplies the required terrain port explicitly; it is marked test-only and is not claimed as production terrain evidence.

### Normal attack composition

A player attack against WS25 runtime ID `20001` crosses WS03 -> WS19 with session-authoritative source identity and resolves the real WS25 target. Client-supplied absurd interval/distance values do not become authority.

With the pinned WS17/WS19 pair, the request intentionally fails closed at the WS19 domain result `ATTACK_TIMER_UNAVAILABLE`, because WS17 exposes raw legacy weapon `range`/`delay` but the pinned provider set does not provide a verified conversion into WS19 `weaponRange` / `attackDelayMs`. No guessed conversion or client fallback is introduced.

The same composition proves:

- unknown target -> WS19 `INVALID_TARGET`;
- dead source -> WS19 `SOURCE_DEAD`;
- failed attack does not mutate WS25 mob HP.

The pinned WS25 snapshot also does not yet expose target AC/evasion combat stats needed for completed normal-attack damage resolution. That remains an explicit provider boundary gap rather than being synthesized in WS03.

### Skill composition

The pinned WS19 verified skill `104001` (Tiny Healing) is sent through `WIZ_MAGIC_PROCESS` EFFECTING and reaches the real WS19 semantic effect/result path. The test proves the client-claimed source ID is ignored and session entity ID remains authoritative; the effect changes HP through WS19 domain logic.

## Outbound boundary

WS03 emits typed semantic combat events through `onCombatEvent`:

- `NORMAL_ATTACK_RESULT`
- `MAGIC_PROCESS_RESULT`

No S2C combat packet encoder was copied into WS03.

WS11 currently has exact protocol-lab authority/serialization tooling, but this pinned dependency does not expose a WS11-owned production/runtime JavaScript encoder/codec surface for WS03 to consume. Until that surface exists, WS03 intentionally returns no fabricated combat result packet and records the semantic result at the typed outbound boundary.

## Regression / CI evidence

Run #9 / `38628385376`:

- syntax check: **SUCCESS**;
- WS03 regression/production-session suite: **42/42 PASS**;
- immutable provider pin validation: **SUCCESS**;
- pinned provider object fetch/materialization: **SUCCESS**;
- real composed contracts: **2/2 PASS**;
- dependency report artifact: `ws03-resolved-providers-9`, artifact id `11925320784`, digest `sha256:17aba7414260d5af96f8ab0fc203e8378898af9e3247c3afb0e4f1c38fa75627`.

Existing auth, character selection, world bootstrap, movement, NPC routing, ownership, disconnect, queue/backpressure and public-staging compatibility regressions remain GREEN.

## Explicit remaining blockers

1. **NORMAL_ATTACK_EQUIPMENT_UNIT_AUTHORITY** — pinned WS17 raw range/delay -> WS19 normalized weaponRange/attackDelayMs conversion is not verified; normal attack therefore fails closed at domain result rather than applying damage.
2. **MOB_COMBAT_TARGET_STATS** — pinned WS25 public runtime snapshot does not expose target AC/evasion combat stats required by WS19 damage resolution.
3. **COMBAT_S2C_RUNTIME_ENCODER** — pinned WS11 does not expose a WS11-owned production/runtime JS encoder/codec surface for WS03 consumption. Typed semantic outbound combat events are ready; fabricated packet encoding is forbidden.

## Integration readiness

**YES for a WS50 child candidate that consumes this exact WS03 head/provider snapshot and preserves the three blockers above.**

This is not a claim that browser-visible normal-attack damage/result packets are complete. It is a verified inbound/session-authority integration milestone: real KO1298 attack/magic ingress reaches the real WS19 boundary, real WS25 target routing is exercised, real WS15/WS17 provider boundaries participate, verified WS19 skill effect/result works, and all unavailable authority remains fail-closed.
