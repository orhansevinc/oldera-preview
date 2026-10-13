WS03

# KO 1298 session protocol evidence

WS03 implements only packet/session behavior proven by the real 1298 client evidence consumed for this control task. Character UI behavior remains WS04-owned and world bootstrap remains WS14-owned.

## Evidence pins

- WS11 protocol lab: `ws11-protocol-lab@05562662d9d3f13a4b0500d0478e065fd802cfd0`
- WS04 client contract: `ws04-character-client@fffbd9372b67c2aaef600f7e50595bec7e23fe88`
- WS14 world contract: `ws14-world-session@82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`
- Control snapshot read from `main@6bf5ffa72585249ded580645bcbdb53359838953`

## KO frame

Plaintext packet framing remains:

```text
AA 55 | payload_length:u16LE | payload | 55 AA
```

The decoder treats TCP as a byte stream; it does not depend on one packet per socket read.

## Version / JV cryption decision

The actual browser-client source inspected by WS11 compiles `_CRYPTION`. Its `WIZ_VERSION_CHECK` response parser reads:

```text
0x2B | version:i16LE | publicKey:u64LE
```

The same evidence proves that `InitCrypt(publicKey)` enables JvCryption only when `publicKey != 0`. WS03 therefore returns version `1298` plus an explicit eight-byte zero key. This is not a guessed crypt implementation: it is the source-verified no-crypto mode of the actual client variant. WS03 rejects configuration of a non-zero key because it does not implement JvCryption.

Default response payload:

```text
2B 12 05 00 00 00 00 00 00 00 00
```

## Character list — WIZ_ALLCHAR_INFO_REQ (0x0C)

Client request:

```text
0C
```

Authenticated success response:

```text
0C | 01 | slot0 | slot1 | slot2
```

Exactly three records are emitted. Each occupied record is:

```text
nameLen:i16LE
name:bytes[nameLen]
race:u8
class:i16LE
level:u8
face:u8
hair:u8
zone:u8
helmetItem:u32LE      helmetDurability:i16LE
upperItem:u32LE       upperDurability:i16LE
cloakItem:u32LE       cloakDurability:i16LE
rightHandItem:u32LE   rightHandDurability:i16LE
leftHandItem:u32LE    leftHandDurability:i16LE
lowerItem:u32LE       lowerDurability:i16LE
glovesItem:u32LE      glovesDurability:i16LE
shoesItem:u32LE       shoesDurability:i16LE
```

An empty slot is exactly 57 zero bytes. Thus the authenticated empty-list payload is 173 bytes and its complete AA55 frame is 179 bytes, matching the WS11 source-derived fixture.

## Character create — WIZ_NEW_CHAR (0x02)

Request consumed from the real WS04 client contract:

```text
02
slot:u8
name:str16
race:u8
class:i16LE
face:u8
hair:u8
strength:u8
stamina:u8
dexterity:u8
intelligence:u8
magicAttack:u8
```

The source-verified client success response is exactly:

```text
02 00
```

On success the client returns to Character Select and immediately requests `0x0C` again. WS03 persists the new character in its repository boundary before returning success, so that refresh contains the occupied slot.

Only `0` is asserted as a verified success result here. WS03 uses a generic non-zero failure internally for invalid development-fixture requests and does not claim an unverified mapping of legacy create error numbers.

## Character select — WIZ_SEL_CHAR (0x04)

Request:

```text
04
account:str16
character:str16
zoneInit:u8
zoneCurrent:u8
```

Before world handoff WS03 verifies:

- a game account is authenticated;
- request account equals the authenticated account;
- `zoneInit == 1` for initial character entry;
- the selected character exists in that authenticated account.

WS03 does not build a competing success response. With the WS14 provider present, it calls:

```js
world.beginSelectedCharacter({ accountId, characterId, socketId })
```

and relays WS14's first `clientPackets` entry. WS14 owns the success packet layout and Moradon placement. Without that provider WS03 returns `04 00` rather than fabricating world success.

## Post-select WS14 routing

After a successful WS14 selection handoff, only WS14-owned world-session opcodes are forwarded to `world.handleClientPacket(socketId, payload)`:

- `0x0D` WIZ_GAMESTART
- `0x16` WIZ_REQ_USERIN
- `0x1D` WIZ_REQ_NPCIN
- `0x27` WIZ_ZONE_CHANGE

Returned `clientPackets` are sent back on the existing GAME connection. `broadcastPackets` are surfaced to the caller through the WS03 broadcast callback; WS03 does not duplicate WS14 region/world logic.
