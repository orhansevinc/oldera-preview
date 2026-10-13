# WS16

## KO 1298 NPC protocol notes

Reference baseline used for packet layout: `ko4life-net/ko` commit `e2028240c7cfc011264cdecbd91baee4e3cdeb29`.

### Verified constants

- `WIZ_NPC_INOUT = 0x0A`
- `WIZ_NPC_MOVE = 0x0B`
- `WIZ_NPC_REGION = 0x1C`
- `WIZ_REQ_NPCIN = 0x1D`
- `WIZ_NPC_EVENT = 0x20`
- `WIZ_TARGET_HP = 0x22`
- `NPC_IN = 0x01`
- `NPC_OUT = 0x02`
- `NPC_BAND = 10000`
- `INVALID_BAND = 30000`
- `VIEW_DISTANCE = 48`
- `NORMAL_OBJECT = 0`
- `NPC_MERCHANT = 21`
- `ZONE_MORADON = 21`

### WIZ_NPC_INOUT / NPC_IN

Little-endian payload:

| Field | Type |
|---|---|
| opcode | u8 = `0x0A` |
| in/out | u8 = `0x01` |
| runtime NPC id | u16 |
| client resource/model id (`sPid`) | u16 |
| NPC type | u8 |
| selling group | u32 |
| size | u16 |
| weapon 1 | u32 |
| weapon 2 | u32 |
| name length | u16 |
| name | raw bytes |
| group | u8 |
| level | u8 |
| X | u16, reference server casts coordinate then multiplies by 10 |
| Z | u16, reference server casts coordinate then multiplies by 10 |
| Y | i16, reference server casts coordinate then multiplies by 10 |
| gate open | u32 |
| object type | u8 |

`NPC_OUT` is only: `0x0A`, `0x02`, runtime NPC id (u16).

Direction is kept in the server-side NPC instance because it exists in `K_NPCPOS.byDirection`; it is not added to `WIZ_NPC_INOUT`, because the verified 1298 packet does not contain a direction field.

### Nearby NPC discovery

The reference server partitions X/Z by `VIEW_DISTANCE=48`. The client receives a region NPC id list and requests details for ids it does not already know.

1. Server -> client `WIZ_NPC_REGION (0x1C)`: opcode, u16 count, repeated u16 runtime NPC ids.
2. Client -> server `WIZ_REQ_NPCIN (0x1D)`: opcode, u16 count, repeated u16 runtime NPC ids.
3. Server -> client `WIZ_REQ_NPCIN (0x1D)`: opcode, u16 count, repeated NPC records using the same record body consumed by `MsgRecv_NPCIn()`.

WS16 uses the reference server's 3x3 region neighborhood rule: current region plus one adjacent region in each X/Z direction.

### NPC interaction

The real client sends `WIZ_NPC_EVENT (0x20)` as opcode u8 + selected runtime NPC id u16. WS16 routes merchant NPCs to `merchant({ session, npc })` and other/future NPCs to `quest({ session, npc })`. Inventory, buying/selling, quest state and combat stay out of WS16.

### Target packet

The real client target HP request is opcode `0x22`, runtime target id u16, immediate flag u8. The verified client receive layout is opcode `0x22`, id u16, immediate u8, max HP u32, current HP u32, HP change i16.

### Verified Moradon seed

Data source: `Open-KO/OpenKO-db` commit `bec619466938d278339c30e5b1a4bff3c9413bab`.

Caspy template: `sSid=13001`, `sPid=22000`, name `Caspy[Accessory]`, size 100, group 2, type 21, selling group 203002, level 50, HP 30000.

Position row: `(21, 13001, 103, 0, 0, 0, 0, 307, 399, 310, 397, 306, 400, 310, 396, 1, 4400, 0, 2, N'0307039803090398')`.

The first encoded path point is `307,398`; direction is 0. `K_NPCPOS` does not contain terrain Y, so WS16 stores `y: null` and requires an integration-time terrain/world height resolver rather than guessing a value.
