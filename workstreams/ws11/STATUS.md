# WS11 STATUS — KO 1298 Protocol Evidence Authority

Status: **IMPLEMENTED — CI VERIFYING**

Branch: `ws11-protocol-lab`
Base HEAD: `05562662d9d3f13a4b0500d0478e065fd802cfd0`

## What changed

WS11 now has a gameplay-focused machine-readable authority (`protocol-lab/gameplay-authority.json`), an explicit provider ownership matrix, pinned source manifest, deterministic binary golden fixtures, negative fixtures, strict gameplay frame parser/serializer, fixture validator, packet diff utility, unknown reporter, fuzz/negative tests, and expanded CI.

No other workstream product code is modified.

## Evidence policy

Production truth precedence:
1. exact 1298 client sender/parser,
2. matching 1298 server sender/parser,
3. canonical WS10 Moradon browser capture,
4. corroborating OpenKO evidence.

Other protocol versions are comparative only. Unproven layout details remain `PARTIAL` / `UNKNOWN`.

## Critical blocker outcomes

- WS17 inbound base mapping resolved for `WIZ_ITEM_MOVE (0x1F)`.
- WS19 inbound normal attack resolved for `WIZ_ATTACK (0x08)`.
- WS19 magic family resolved for `WIZ_MAGIC_PROCESS (0x31)`, including commands 1..6 and the short Type4 duration-expired variant for command 5.
- `WIZ_REQ_NPCIN (0x1D)` ownership collision resolved as WS14 world lifecycle + WS16 NPC-record semantics, routed/gated by WS03.
- WS22 merchant/player-trade full subprotocol remains UNKNOWN.
- WS26 ITEM_DROP / ITEM_GET full body remains UNKNOWN.
- WS27 LEVEL_CHANGE remainder remains PARTIAL.

## Counts

The final closeout commit updates authoritative counts after CI.

## Canonical capture

WS10 canonical Moradon PASS remains run `38505039290`, head `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`. Its observed 0x1D request/response sequence corroborates the exact 1298 source interpretation.
