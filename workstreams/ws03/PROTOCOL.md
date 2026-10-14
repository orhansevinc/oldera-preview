WS03

# KO 1298 session protocol evidence

WS03 implements only packet/session behavior supported by current 1298 evidence. The authoritative ownership list is `workstreams/ws03/OPCODE_MATRIX.md`.

## Frame

```text
AA 55 | payload_length:u16LE | payload | 55 AA
```

The TCP decoder is stream-oriented and rejects malformed header/length/tail frames fail-closed.

## Version / JV cryption

The verified browser client reads:

```text
0x2B | version:i16LE | publicKey:u64LE
```

WS03 returns version `1298` and public key `0`. Non-zero JvCryption remains unsupported rather than being guessed.

## Character path retained

- `0x0C WIZ_ALLCHAR_INFO_REQ` — exactly three serialized slots.
- `0x02 WIZ_NEW_CHAR` — existing verified create request/success behavior.
- `0x04 WIZ_SEL_CHAR` — account match, character ownership, initial zone flag, WS45 character lease if configured, then WS14 `beginSelectedCharacter()`.
- WS03 never fabricates Moradon world success when WS14 is absent.

## World path retained

WS14 remains authoritative for:

- `0x0D WIZ_GAMESTART`
- `0x16 WIZ_REQ_USERIN`
- default `0x1D WIZ_REQ_NPCIN`
- `0x27 WIZ_ZONE_CHANGE`

WS03 relays returned client packets and world broadcasts and mirrors only the authenticated session identity/lifecycle state required for routing.

## Added verified gameplay routes

From WS15 source contract:

```text
0x06 WIZ_MOVE   : x:u16 z:u16 y:i16 speed:u16 flag:u8 (9 bytes after opcode)
0x09 WIZ_ROTATE : heading:i16 (2 bytes after opcode)
```

From WS16 source contract:

```text
0x1D WIZ_REQ_NPCIN : count:u16 + repeated npcId:u16  (ownership conflict; WS14 default)
0x20 WIZ_NPC_EVENT : npcId:u16
0x22 WIZ_TARGET_HP : targetId:u16 + immediate:u8
```

No WS17/WS19/WS22 client opcode is registered until a verified mapping is provided.
