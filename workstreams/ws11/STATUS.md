# WS11 STATUS — KO 1298 Protocol Evidence Authority

Status: **PASS — DOWNSTREAM READY WITH EXPLICIT UNKNOWN GATES**

Branch: `ws11-protocol-lab`
Base HEAD: `05562662d9d3f13a4b0500d0478e065fd802cfd0`
Authority commit: `5e8a42578c7350d8b4b3a4fbae4e628e5f3b8c7e`
Validated CI: `WS11 KO1298 Protocol Lab` run `38567814152` — **SUCCESS**

## Authority summary

- Verified packet/opcode families: **14**
- Fully specified fixed packet variants/layouts: **22**
- Partial / UNKNOWN packet families: **8**
- New gameplay golden binary fixtures: **10**
- Negative binary fixtures: **7**
- Protocol owner matrix rows: **24**
- Canonical WS10 capture contradictions against exact WS11 layouts: **0**
- Provider HEAD snapshot recorded for WS03/14/15/16/17/19/22/25/26/27 and WS31.

## Evidence policy

Production truth precedence is fixed to:
1. exact 1298 client sender/parser,
2. matching 1298 server sender/parser,
3. canonical WS10 browser capture,
4. corroborating OpenKO evidence.

1097, 1098, modern KO, and other-version material are comparative only. Any unsupported opcode, subopcode, field width, signedness, direction, scaling, encoding, variant, or state requirement remains `PARTIAL` / `UNKNOWN`; no production guess is allowed.

Pinned exact source commit: `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`.
Canonical WS10 capture: head `f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41`, run `38505039290`.

## Critical blockers resolved

- WS17 inbound base mapping: `WIZ_ITEM_MOVE = 0x1F` with exact C2S core layout.
- WS19 inbound normal attack: `WIZ_ATTACK = 0x08` with exact C2S normal-attack layout.
- WS19 skill family: `WIZ_MAGIC_PROCESS = 0x31`, commands `1..6`; command `5` is the verified duration-expired / TYPE3_END / TYPE4_END alias and has an exact short Type4 expiry variant.
- `WIZ_REQ_NPCIN = 0x1D` ownership collision resolved: WS03 routes/gates, WS14 owns world/bootstrap request lifecycle, WS16 owns NPC record/detail semantics. Canonical WS10 corroborates C2S 5-byte request followed by S2C detail.

## Remaining explicit UNKNOWN / PARTIAL blockers

- WS22 merchant buy/sell and player-trade full subprotocol layouts are still UNKNOWN.
- WS26 `WIZ_ITEM_DROP` / `WIZ_ITEM_GET` full wire layouts are still UNKNOWN.
- WS27 `WIZ_LEVEL_CHANGE` body after exact `entity_id + level` prefix is PARTIAL.
- `WIZ_TARGET_HP` C2S query is exact; the full S2C response body remains PARTIAL.
- WS17 item-count and item-remove packet bodies remain PARTIAL / UNKNOWN.
- WS25 mob lifecycle events reuse verified combat/world families, but there is not yet a distinct complete client encoder catalog for every mob lifecycle event.

These packets are intentionally blocked from production encoding until exact evidence exists.

## Golden / negative corpus

The gameplay golden corpus contains deterministic binary fixtures for movement, rotation, normal attack, town regeneration, bundle-open request, NPC event, generic magic casting, short Type4 duration expiry, death, and EXP change. Existing auth/session regression fixtures are retained unchanged.

Negative corpus covers truncated frame, oversized declared length, wrong string length, invalid magic command, impossible attack enum, malformed header, and unknown opcode. Integer-width overflow is rejected by the serializer before bytes are emitted.

## Tooling

WS11 now includes:
- strict AA55/u16le-length/payload/55AA frame parser,
- authority-driven gameplay pretty printer,
- fixed-layout serializer helper,
- deterministic golden/negative fixture generator,
- manifest SHA/hex integrity validator,
- protocol authority/schema + owner-matrix validator,
- packet diff utility,
- unknown/partial reporter,
- roundtrip tests,
- fuzz/fail-closed tests,
- canonical WS10 capture audit.

## Tests and CI

Local validation before commit:
- authority validator: PASS,
- gameplay fixture validator: PASS,
- gameplay authority tests: **12/12 PASS**,
- deterministic 1000-frame fuzz: no crash outside controlled `ProtocolError`,
- serializer width-overflow rejection: PASS.

GitHub Actions run `38567814152` on authority commit `5e8a42578c7350d8b4b3a4fbae4e628e5f3b8c7e`: **SUCCESS**. Regeneration/clean-tree, authority/ownership validation, tests, decoder smoke, and replay dry-run all passed.

## Downstream readiness

WS11 is **DOWNSTREAM READY** for the verified packet families and owner mappings above. Downstream workstreams must use the explicit UNKNOWN/PARTIAL gates rather than invent wire formats.
