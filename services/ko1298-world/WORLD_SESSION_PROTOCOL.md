WS14

# KO 1298 World Session Protocol

This module owns only the server-side transition from an already validated character selection into the Moradon world session. It deliberately does not implement transport, authentication, combat, movement, inventory operations, NPC AI, persistence migrations, admin or website behavior.

## Evidence policy

No packet shape in this module is inferred from modern KO behavior. Protocol bytes are pinned to the Open-KO 1.298 source tree at commit `7d6cf81093e142c928c2ac9510512b2b182178b5`, whose client declares `CURRENT_VERSION = 1298` in `src/Client/WarFare/GameDef.h`.

Primary references:

- 1298 client version and client world handshake:
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Client/WarFare/GameDef.h`
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Client/WarFare/GameProcMain.cpp`
- Shared opcode/sub-opcode definitions:
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/shared/packets.h`
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/shared/globals.h`
- 1298 world server behavior (`SelChar`, `SendMyInfo`, `GetUserInfo`, `GameStart`, `ZoneChange`):
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Server/Ebenezer/User.cpp`
- 1298 surrounding user/NPC region bootstrap:
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Server/Ebenezer/EbenezerApp.cpp`
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Server/Ebenezer/Npc.cpp`
- `SetString1` definition (one-byte length prefix):
  - `https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Server/shared-server/utilities.cpp`
- Moradon zone/spawn evidence:
  - `https://github.com/Open-KO/OpenKO-db/blob/bec619466938d278339c30e5b1a4bff3c9413bab/ManualSetup/6_InsertData_ZONE_INFO.sql`
  - row: zone `21`, map `moradon_0826.smd`, InitX `31200`, InitZ `40200`, InitY `0` -> world `312.0 / 402.0 / 0.0`.

Older source trees that identify themselves as a different protocol version are not accepted as standalone 1298 evidence.

## Ownership boundary with WS03

WS03 owns authentication/session prerequisites and validates that the incoming character selection belongs to the authenticated account. WS14 does not read credentials and does not decide whether an account may select a character.

Integration boundary:

1. WS03 validates the selection request and binds `accountId`, `characterId`, and the game-server `socketId`.
2. WS03 calls `WorldSessionService.beginSelectedCharacter(...)`.
3. WS14 loads the world snapshot from its repository interface, chooses Moradon placement, and returns the `WIZ_SEL_CHAR` success response containing world placement.
4. The caller sends returned `clientPackets` on the already-existing transport.
5. Subsequent client world packets (`WIZ_GAMESTART`, `WIZ_REQ_USERIN`, `WIZ_REQ_NPCIN`, `WIZ_ZONE_CHANGE`) are routed to `handleClientPacket()`.
6. Packets in `broadcastPackets` are broadcast by the owning server/region transport; WS14 itself opens no socket.

WS14 does not modify or import WS03 implementation code.

## Selected-character initialization

For the WS14 milestone, selected characters are placed into:

- zone: `21` (Moradon)
- X: `312.0`
- Z: `402.0`
- Y: `0.0`

`WIZ_SEL_CHAR (0x04)` success response layout:

| Field | Type |
| --- | --- |
| opcode | u8 = `0x04` |
| result | u8 = `1` |
| zone | u8 |
| X × 10 | u16 LE |
| Z × 10 | u16 LE |
| Y × 10 | i16 LE |
| old victory nation | u8 |

For the default Moradon position and victory `0`, the packet is:

`04 01 15 30 0c b4 0f 00 00 00`

## 1298 GAMESTART handshake

The 1298 client does not send the older character-name form. It sends a phase byte:

1. client -> server: `0D 01` (`WIZ_GAMESTART`, loading)
2. server -> client:
   - `WIZ_MYINFO (0x0E)`
   - `WIZ_ZONEABILITY (0x5E)` for Moradon
   - `WIZ_REGIONCHANGE (0x15)` nearby user IDs
   - `WIZ_NPC_REGION (0x1C)` nearby NPC IDs
   - `0D` server GAMESTART acknowledgement
3. client may request missing entity details with `0x16` / `0x1D` while loading.
4. client -> server: `0D 02` (loaded)
5. server marks the session `WORLD_READY` and emits the player `WIZ_USER_INOUT` with `USER_REGENE = 3` for region broadcast.

The server does not mark the player world-ready after phase 1.

## MYINFO (0x0E)

The serializer follows 1.298 `CUser::SendMyInfo(0)`.

Important 1298-specific details enforced by tests:

- character ID uses `SetString1`: `u8 length + bytes`.
- monthly loyalty is a separate `u32` after loyalty.
- clan block includes alliance ID, flag, `SetString1` name, grade, ranking, mark version and cape.
- no-clan cape is `-1` (`i16`).
- gold is a 32-bit value.
- knights rank and personal rank are emitted before the 9 skill bytes.
- exactly `SLOT_MAX + HAVE_MAX = 42` item records are serialized.
- every 1298 MYINFO item record is 11 bytes:
  - item ID `u32`
  - duration `u16`
  - count `u16`
  - flag `u8`
  - remaining rental time `u16`
- trailing account/premium fields are preserved: account status, premium type, premium time, chicken flag, manner point.

The repository is responsible for supplying already-derived initial stats (`maxHp`, `totalHit`, resistances, etc.). WS14 serializes those values but does not implement stat/combat formulas.

### Moradon zone ability

`SendMyInfo()` in the 1298 source is followed by zone-ability state. For Moradon:

- `WIZ_ZONEABILITY = 0x5E`
- sub-opcode `ZONE_ABILITY_UPDATE = 1`
- cross-nation trade = true
- ability type = neutral (`0`)
- cross-nation chat = true
- base tariff = `10`

Default packet: `5e 01 01 00 01 0a 00`.

## Surrounding entity initialization

1298 bootstraps surrounding entities in two steps rather than immediately sending every detail record.

### User IDs

Server first sends:

`WIZ_REGIONCHANGE (0x15) + count(u16) + socketId(u16)[]`

The client requests unknown users with:

`WIZ_REQ_USERIN (0x16) + count(u16) + socketId(u16)[]`

The server replies with `0x16 + count`, then for each user:

- socket ID `u16`
- 1298 `GetUserInfo()` body
- character/clan names are `SetString1`
- abnormal type is a `u32`
- 8 visible equipment slots are each `itemId(u32) + duration(u16) + flag(u8)`

### NPC IDs

Server first sends:

`WIZ_NPC_REGION (0x1C) + count(u16) + nid(u16)[]`

The client requests unknown NPCs with `WIZ_REQ_NPCIN (0x1D)`. The response body follows 1298 `CNpc::GetNpcInfo()`, including the gate-open DWORD, two client placeholder shorts (`sIDK0/sIDK1`) and direction byte.

No NPC AI is implemented; WS14 only serializes repository-provided static world snapshots.

## 1298 zone change handshake

Sub-opcodes are source-defined:

- `ZONE_CHANGE_LOADING = 1`
- `ZONE_CHANGE_LOADED = 2`
- `ZONE_CHANGE_TELEPORT = 3`

Server-initiated teleport packet:

`27 03 <zone:u8> <subzone:u8> <x:u16> <z:u16> <y:i16> <victory:u8>`

Moradon default:

`27 03 15 00 30 0c b4 0f 00 00 00`

Then:

1. client -> server: `27 01`
2. server refreshes nearby IDs and sends `0x15`, `0x1C`, then `27 02`
3. client may resolve entity details with `0x16` / `0x1D`
4. client -> server: `27 02`
5. server returns to `WORLD_READY` and broadcasts `USER_REGENE`.

## Explicit non-goals

This workstream intentionally does not own:

- movement (`WIZ_MOVE`)
- combat/attack
- inventory mutations or item movement
- NPC AI/pathfinding
- database migrations
- WebSocket/TCP gateway behavior
- client/WASM changes
- authentication/registration/admin/site behavior

Unsupported product opcodes are rejected rather than silently handled.
