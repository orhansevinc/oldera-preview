# Knight Online 1298 Protocol Lab

## Scope and evidence policy

This lab documents the packet behavior exercised by the **real 1298 client path** used by OldKOWeb. It does not invent server semantics.

Evidence was taken from:

- OldKOWeb base: `orhansevinc/oldera-preview@18282d0e70de7ccb30244a9f09e2b3bff3040155` (`openko-browser-port`).
- The base workflow checks out `luisfelipe18/old-school-openko`, branch `feature/port-posix`.
- This lab pins that upstream source at commit `97eb0ea20207afc0c360bfed6915113572711be3`.
- The base network proof already observes the exact login-server list request frame `aa550100f555aa` through browser WebSocket -> gateway -> KO TCP.
- WS03 was treated as read-only reference only. No WS03, gateway, client, database, admin or website code is changed by WS11.

`opcodes.json` contains every top-level login and game opcode present in the inspected `src/shared/packets.h`. Direction, size and layout are populated only where the client source was inspected and verified. Everything else is explicitly `UNKNOWN`.

## Wire framing

The inspected `CAPISocket` uses this outer wire frame:

```text
+--------+----------------------+------------------+--------+
| AA 55  | payload_len uint16LE | payload N bytes  | 55 AA  |
+--------+----------------------+------------------+--------+
  2 B              2 B                N B             2 B
```

Total frame size is `payload_len + 6` bytes. Application opcode is the first payload byte **only while the application body is plaintext**.

Known observed frame:

```text
AA 55 01 00 F5 55 AA
|hdr| len=1 |F5| tail |
```

This is `LS_SERVERLIST` C2S and is already asserted by the browser network proof in the base branch.

### Endianness

The client packet builders use `memcpy()` of native integer values. The inspected/browser target is little-endian, so verified integer fields in this lab are decoded little-endian. Header and tail are deliberately written with byte swapping to appear as literal `AA55` and `55AA` on the wire.

## Transport boundary: TCP vs browser WebSocket

The browser port does **not** replace KO framing with an application JSON/WebSocket protocol. The browser patch preserves `CAPISocket` framing/cryption and changes only the transport write/read mechanism to Emscripten binary WebSocket. The gateway then carries those KO bytes to TCP.

Therefore WS11 treats KO data as a byte stream. A decoder must not rely on WebSocket message boundaries; it uses `payload_len` and the `AA55`/`55AA` frame markers.

## Cryption boundary

The inspected `APISocket.h` defines `_CRYPTION`, so JvCryption support is compiled into this client variant. That does **not** mean every packet starts encrypted.

State verified from the client source:

1. New/disconnected sockets call `InitCrypt(0)`, leaving `s_bCryptionFlag = FALSE`.
2. `WIZ_VERSION_CHECK` C2S is sent plaintext.
3. The version response is processed as plaintext. The client reads:
   - `opcode:u8 = 0x2B`
   - `version:i16LE`
   - `publicKey:u64LE`
4. While processing that response, `InitCrypt(publicKey)` enables crypt only if the key is non-zero.
5. Subsequent game sends are encrypted if the key is non-zero.

Verified C2S encrypted pre-encryption body assembled by the client:

```text
sequence:uint32 + application_payload + crc32(sequence + application_payload):uint32
```

That body is Jv-encrypted and placed inside the normal `AA55 / length / encrypted bytes / 55AA` outer frame.

Verified S2C post-decryption expectation in the client:

```text
signature:uint16 == 0x1EFC
sequence:uint16            # present in source comments/offsets
reserved:uint8
application_payload...
```

The WS11 decoder intentionally does **not** guess or reimplement JvCryption key scheduling. With `--encrypted`, it validates the outer frame and reports the inner body as `UNKNOWN_ENCRYPTED_BODY`.

`LS_CRYPTION (0xF2)` exists in the login opcode enum, but its exact 1298 login-scene semantics were not verified in the inspected flow; it remains `UNKNOWN` in the catalog.

## Source-verified login -> zone chain

The user-facing phrase “Login -> Server List” can be misleading. In the actual 1298 login scene, merely connecting to the login server causes the client to request the server list **before** the player submits credentials.

| Stage | Connection | Direction | Opcode | Verified action |
|---|---|---:|---:|---|
| Login scene connect | login `:15100` | C2S | `F5 LS_SERVERLIST` | one-byte request |
| Server list | login | S2C | `F5 LS_SERVERLIST` | count + variable server records |
| Credential login | login | C2S | `F3 LS_LOGIN_REQ` | account/password length-prefixed strings |
| Auth result | login | S2C | `F3 LS_LOGIN_REQ` | result byte; result 1 triggers news request |
| News request | login | C2S | `F6 LS_NEWS` | one-byte request |
| Choose game server | local UI | — | — | disconnect/connect boundary is application behavior, not a packet opcode |
| Game connect | game `:15001` | C2S | `2B WIZ_VERSION_CHECK` | one-byte request |
| Version answer | game | S2C | `2B WIZ_VERSION_CHECK` | version 1298 + uint64 public key |
| Game login | game | C2S | `01 WIZ_LOGIN` | account/password |
| Nation status | game | S2C | `01 WIZ_LOGIN` | nation 0/1/2/FF |
| Nation select (only if nation=0) | game | C2S | `05 WIZ_SEL_NATION` | nation byte |
| Nation result | game | S2C | `05 WIZ_SEL_NATION` | nation byte |
| Character list request | game | C2S | `0C WIZ_ALLCHAR_INFO_REQ` | one-byte request |
| Character list | game | S2C | `0C WIZ_ALLCHAR_INFO_REQ` | result + exactly 3 source-read slots on success |
| Character select | game | C2S | `04 WIZ_SEL_CHAR` | account + char + zone-init/current bytes |
| Character result | game | S2C | `04 WIZ_SEL_CHAR` | success + zone/position/victory data |
| Enter main/zone | client local | — | — | successful select transitions to `CGameProcMain`; `InitZone()` loads the zone |
| Zone/game handshake phase 1 | game | C2S | `0D WIZ_GAMESTART` | phase byte `01` after resource preload |
| Server game-start signal | game | S2C | `0D WIZ_GAMESTART` | opcode verified; body not read by inspected handler => `UNKNOWN` |
| Zone/game handshake phase 2 | game | C2S | `0D WIZ_GAMESTART` | phase byte `02` |

A later in-game zone transfer has an enum opcode `WIZ_ZONE_CHANGE (0x27)`, but its structure is outside the verified login-to-first-zone scope here and is therefore catalogued `UNKNOWN` rather than inferred.

## Verified packet layouts

All sizes below are **payload sizes**, including the one-byte opcode but excluding the 6-byte outer frame overhead.

### `LS_SERVERLIST (0xF5)`

C2S:

```text
opcode:u8
```

S2C:

```text
opcode:u8
serverCount:u8
repeat serverCount:
  ipLen:i16LE
  ip:bytes[ipLen]
  nameLen:i16LE
  name:bytes[nameLen]
  concurrentUsers:i16LE
```

### `LS_LOGIN_REQ (0xF3)` / `LS_MGAME_LOGIN (0xF4)`

C2S:

```text
opcode:u8
accountLen:i16LE
account:bytes[accountLen]
passwordLen:i16LE
password:bytes[passwordLen]
```

The client applies its network string conversion before sending. ASCII fixture strings are used so encoding does not create ambiguity.

S2C starts with:

```text
opcode:u8
authResult:u8
```

Verified result values from the shared source are 1 OK, 2 not found, 3 invalid password, 4 banned/maintenance semantics as used by this client path, 5 already in game, 6 error, FF failed. In the client login handler, result `5` additionally reads:

```text
ipLen:i16LE
ip:bytes[ipLen]
port:i16LE
```

### `LS_NEWS (0xF6)`

C2S is opcode only. S2C:

```text
opcode:u8
labelLen:u16LE
label:bytes[labelLen]
contentLen:u16LE
content:bytes[contentLen]
```

The inspected UI accepts label `Login Notice` and bounds content length below 4096.

### `WIZ_VERSION_CHECK (0x2B)`

C2S: opcode only.

S2C in the inspected `_CRYPTION` build:

```text
opcode:u8
version:i16LE
publicKey:u64LE
```

`version` must equal `1298` for this path to continue. A zero public key keeps JvCryption inactive; a non-zero key activates it for subsequent packets.

### `WIZ_LOGIN (0x01)`

C2S uses the same source-verified credential layout as above. S2C:

```text
opcode:u8
nation:u8   # 0 unselected, 1 Karus, 2 Elmorad, FF failure in client logic
```

### `WIZ_SEL_NATION (0x05)`

C2S and S2C body:

```text
opcode:u8
nation:u8
```

### `WIZ_ALLCHAR_INFO_REQ (0x0C)`

C2S is opcode only.

S2C starts:

```text
opcode:u8
result:u8
```

When `result == 1`, the client reads exactly three character slots. Each slot is:

```text
idLen:i16LE
id:bytes[idLen]
race:u8
class:i16LE
level:u8
face:u8
hair:u8
zone:u8
helmetItem:u32LE       helmetDurability:i16LE
upperItem:u32LE        upperDurability:i16LE
cloakItem:u32LE        cloakDurability:i16LE
rightHandItem:u32LE    rightHandDurability:i16LE
leftHandItem:u32LE     leftHandDurability:i16LE
lowerItem:u32LE        lowerDurability:i16LE
glovesItem:u32LE       glovesDurability:i16LE
shoesItem:u32LE        shoesDurability:i16LE
```

A slot has `57 + idLen` bytes. The source-derived empty-list fixture includes all fields for all three empty slots; it does not truncate after empty IDs.

### `WIZ_SEL_CHAR (0x04)`

C2S:

```text
opcode:u8
accountLen:i16LE
account:bytes[accountLen]
charLen:i16LE
character:bytes[charLen]
zoneInit:u8
zoneCurrent:u8
```

S2C:

```text
opcode:u8
result:u8
if result == 1:
  zoneWire:u8
  xRaw:u16LE
  zRaw:u16LE
  yRaw:i16LE
  victoryNation:u8
```

The client divides XYZ raw values by 10.0. For the inspected 1298 format path (`>= 1264`) it multiplies `zoneWire` by 10 before storing it as the current zone. The lab reports both `zone_wire` and `zone_client_1298` so that transformation is visible rather than hidden.

### `WIZ_GAMESTART (0x0D)`

Verified client sends:

```text
opcode:u8
phase:u8   # 01 first phase; 02 after receiving server WIZ_GAMESTART
```

The inspected S2C dispatch reacts to the opcode but does not read a body before sending phase 2. Any S2C body semantics are therefore `UNKNOWN` here.

## Binary fixture format

`protocol-lab/fixtures/*.bin` are raw wire frames, not hex text and not JSON wrappers.

`manifest.json` records for each fixture:

- channel (`login` or `game`)
- direction (`C2S` or `S2C`)
- opcode/name
- payload/frame lengths and hex
- provenance
- notes

Provenance values:

- `observed`: byte-for-byte evidence already asserted by the existing OldKOWeb network proof.
- `source-derived`: complete bytes are directly determined by client source with no example data invented.
- `synthetic-source-derived`: structure is source-verified, while harmless ASCII/sample values are intentionally synthetic.
- `synthetic-unknown`: fixture exists specifically to prove that unverified body fields stay `UNKNOWN`.

`login_to_zone.sequence.json` is a documentation/replay manifest. It includes both directions but explicitly separates login and game connections. The empty-character-list fixture and later synthetic character-select fixture are independent format examples; the sequence does not claim that a real server session can select a nonexistent character.

## Decoder CLI

Examples from repository root:

```bash
python3 tools/ws11_protocol/decode.py \
  --file protocol-lab/fixtures/login_serverlist_request.bin \
  --channel login --direction C2S

python3 tools/ws11_protocol/decode.py \
  --hex aa5501002b55aa \
  --channel game --direction C2S

python3 tools/ws11_protocol/decode.py \
  --file encrypted-capture.bin \
  --channel game --direction S2C --encrypted
```

The decoder can parse concatenated KO frames in one file. It validates header, declared payload length and tail. It does not scan forward and silently resynchronize malformed captures; corruption is an error so tests cannot pass on ambiguous bytes.

## Replay CLI

Dry-run all C2S fixtures in the sequence:

```bash
python3 tools/ws11_protocol/replay.py \
  protocol-lab/login_to_zone.sequence.json --dry-run
```

Dry-run only game connection C2S packets:

```bash
python3 tools/ws11_protocol/replay.py \
  protocol-lab/login_to_zone.sequence.json --channel game --dry-run
```

Replay login C2S fixtures to a TCP test endpoint:

```bash
python3 tools/ws11_protocol/replay.py \
  protocol-lab/login_to_zone.sequence.json \
  --channel login --connect 127.0.0.1:15100 --delay-ms 20
```

Live mode sends only C2S bytes and requires one connection channel, because login and game are separate TCP sessions. It does not generate S2C replies, authenticate accounts, emulate server state, or bypass encryption.

## Tests

Run:

```bash
python3 -m unittest discover -s tests/protocol-lab -p 'test_*.py' -v
```

The automated suite validates framing, the already-observed F5 frame, version/public-key decoding, credential/nation/character layouts, unknown handling, concatenated streams, manifest integrity and byte-exact TCP replay to a local mock receiver.

## UNKNOWN policy

The catalog is intentionally asymmetric: an opcode name being known does **not** imply that its direction, payload size or struct is known. For all entries not explicitly verified in the inspected code, those fields stay `UNKNOWN`. This is a protocol lab, not a speculative private-server implementation.
