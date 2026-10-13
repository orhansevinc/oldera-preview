WS03

# Dependency Snapshot — 2026-10-14

Control snapshot read from `main@6bf5ffa72585249ded580645bcbdb53359838953`.

## Consumed providers / evidence

| Dependency | Frozen branch commit | Consumed surface | WS03 conclusion |
| --- | --- | --- | --- |
| WS04 | `ws04-character-client@fffbd9372b67c2aaef600f7e50595bec7e23fe88` | `STATUS.md`, `INTEGRATION_PATCH.md` | Real client contract for 0x0C / 0x02 / 0x04 is concrete; server must persist create before automatic list refresh. |
| WS11 | `ws11-protocol-lab@05562662d9d3f13a4b0500d0478e065fd802cfd0` | KO1298 protocol lab + fixtures | Actual WASM variant compiles `_CRYPTION`; version response includes `u64` key; zero key is the verified way to keep plaintext. |
| WS14 | `ws14-world-session@82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` | `STATUS.md`, `INTEGRATION_PATCH.md`, `WorldSessionService` contract | Revalidation is closed with valid evidence; WS03 may hand validated selection to `beginSelectedCharacter()` and route only WS14-owned world opcodes afterward. |
| WS50 | `ws50-integration-rehearsal@9112bb4e326d016f3ca8a2a56495e3421ffa76c5` | `REHEARSAL_REPORT.md` | Prior rehearsal marked WS03 blocked by WS14 and reported no actual Git conflict; the WS14 missing-evidence objection was later repaired on its current branch. |

## Central control state

`coordination/MORADON_CRITICAL_PATH.md` defines WS03 as M1: character list/create/select, WS14 handoff, and evidence-based JV decision. This change implements those WS03-owned requirements.

The current `coordination/inbox/WS03.md` closure condition is narrower than full Moradon PASS: the server must drive the WS04 character protocol through create/select and invoke the WS14 boundary. Full world bootstrap/render remains an integrated M2/M3 proof.

## Additional composition boundary

WS14's current closure records WS45 duplicate-session ownership as a pre-world composition policy. WS03 performs authenticated account/character ownership checks before WS14, but this branch does not absorb WS45's cross-process lease implementation or invent a KO numeric error mapping for its semantic rejection codes.

## Readiness / remaining dependencies

- WS04 contract: READY as consumed by WS03.
- WS11 protocol evidence: READY as consumed by WS03.
- WS14 boundary: `INTEGRATION-READY`; its previous WS50 evidence objection is resolved by the later WS14 revalidation commit.
- WS03 implementation after this control task: READY for integrated M2 character E2E validation.
- Production world repository: still required for WS14 MYINFO/GAMESTART beyond the `beginSelectedCharacter()` boundary.
- WS45 production lease store/composition: still required for cross-process duplicate-session enforcement before production world entry.
- WS05 authentic Moradon render gate: still a later M3 proof and is not part of this branch.
