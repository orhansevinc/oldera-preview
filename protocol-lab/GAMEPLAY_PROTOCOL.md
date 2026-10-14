# WS11 KO 1298 Gameplay Protocol Authority

This directory is a fail-closed protocol authority for OldKOWeb. Exact 1298 client/server source and the canonical WS10 browser capture are production evidence. Other versions are comparison only.

## Verified core surfaces

- world bootstrap: `WIZ_GAMESTART`
- movement: `WIZ_MOVE`, `WIZ_ROTATE`, S2C `WIZ_WARP`
- NPC request/event: `WIZ_REQ_NPCIN`, `WIZ_NPC_EVENT`
- combat lifecycle: `WIZ_ATTACK`, `WIZ_DEAD`, `WIZ_REGENE`, `WIZ_HP_CHANGE`
- item core: `WIZ_ITEM_MOVE`, bundle-open request
- skills: `WIZ_MAGIC_PROCESS` commands 1..6 with variant-aware command 5
- progression core: `WIZ_EXP_CHANGE`

The machine-readable source of truth is `gameplay-authority.json`; provider routing is `PROTOCOL_OWNER_MATRIX.json`.

## 0x1D resolution

`WIZ_REQ_NPCIN (0x1D)` is one bidirectional protocol family, not two competing opcodes. WS14 owns the world/bootstrap request lifecycle. WS16 owns NPC record/detail semantics used to satisfy the request. WS03 owns session-state gating and dispatch.

## Explicit UNKNOWN / PARTIAL

Merchant buy/sell, player-trade subprotocol, full item-drop/pickup bodies, item-count/remove bodies, the remainder of level-change, and the full S2C TARGET_HP body are intentionally not guessed.

## Tooling

`gameplay.py` provides strict frame parsing, authority-driven decoding and fixed-layout serialization. `generate_gameplay_fixtures.py` regenerates binary golden/negative fixtures. `fixture_validator.py`, `validate_authority.py`, `packet_diff.py`, and `unknown_report.py` provide CI and investigation tooling.

## Canonical WS10 capture audit

`ws10-capture-audit.json` records every opcode/length pair visible in canonical run 38505039290's composition-server log. Exact WS11 layouts have zero contradictions; the remaining observed `0x41` speedhack-check body is explicitly UNKNOWN for gameplay authority purposes.

`decode_gameplay.py` is the gameplay pretty-printer CLI.
