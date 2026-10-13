# WS04 integration contract

WS04 is client-only. It does not add or patch a gateway, TCP stub, AUTH/GAME server, persistence layer, or packet responder.

The real OpenKO 1298 client already owns the Character Select/Create protocol. The WS04 patch only adds Emscripten console probes and genuine 1298 character-model asset packaging so the existing client behavior can be proven in CI.

## Required GAME-session behavior for the remaining runtime gates

### 1. All-character list — `WIZ_ALLCHAR_INFO_REQ` (`0x0C`)

The client sends one byte: `0x0C`.

Response payload begins with:

- `0x0C`
- result `uint8` (`1` = list follows)
- exactly 3 character records

Each character record is:

- name length: `int16` little-endian
- name bytes
- race: `uint8`
- class: `int16` little-endian
- level: `uint8`
- face: `uint8`
- hair: `uint8`
- zone: `uint8`
- helmet item id `uint32` + durability `int16`
- upper item id `uint32` + durability `int16`
- cloak item id `uint32` + durability `int16`
- right-hand item id `uint32` + durability `int16`
- left-hand item id `uint32` + durability `int16`
- lower item id `uint32` + durability `int16`
- gloves item id `uint32` + durability `int16`
- shoes item id `uint32` + durability `int16`

An empty record is 57 zero bytes. An occupied record is 57 + name-length bytes.

The current `openko-browser-port` game stub returns three empty records. That is sufficient for Nation -> Character Select and empty-slot -> Character Create, but not for create success/refresh/select.

### 2. Character create — `WIZ_NEW_CHAR` (`0x02`)

The real client sends:

- opcode `0x02`
- slot index `uint8`
- character-name length `int16` little-endian
- character-name bytes
- race `uint8`
- class `int16` little-endian
- face `uint8`
- hair `uint8`
- strength `uint8`
- stamina `uint8`
- dexterity `uint8`
- intelligence `uint8`
- magic attack `uint8`

The success response is **`0x02, 0x00`**. In this client, zero is success for `WIZ_NEW_CHAR`; non-zero is a create error code.

On success the genuine client switches back to `CGameProcCharacterSelect`, which immediately sends `0x0C` again. The server must then return the newly created character in the same slot. WS04 expects `occupied=1` in the refreshed list.

### 3. Character select — `WIZ_SEL_CHAR` (`0x04`)

After the refreshed slot is clicked, the genuine client sends:

- opcode `0x04`
- account length `int16` little-endian
- account bytes
- character-name length `int16` little-endian
- character-name bytes
- zone-init `uint8` (`1` for initial entry from character select)
- character zone `uint8`

The client considers the select response successful when its first result byte is `1`. The response parser then reads at least:

- result `uint8` = `1`
- current zone `uint8`
- X `uint16` (wire value / 10.0)
- Z `uint16` (wire value / 10.0)
- Y `int16` (wire value / 10.0)
- victory nation `uint8`

WS04 stops at the real client transition point after successful character selection. World/Moradon loading belongs to WS05 and must not be implemented here.

## Console markers exposed by WS04

- `WS04_ALLCHAR_SENT opcode=0x0c`
- `WS04_CHAR_LIST parsed result=1 slots=3 occupied=N ...`
- `WS04_SLOT_ACTION index=N occupied=0|1 ...`
- `WS04_CHAR_CREATE_UI ... load=1`
- `WS04_CHAR_CREATE_ATTEMPT ...`
- `WS04_CHAR_CREATE_SENT opcode=0x02 ...`
- `WS04_CHAR_CREATE_RESPONSE code=0`
- `WS04_CHAR_SELECT_REQUEST ...`
- `WS04_CHAR_SELECT_RESPONSE success=1`

These are diagnostics only. They do not alter packet contents or client decisions.

## Integration rule

Do not satisfy the blocked gates by injecting a fake DOM character screen, by locally fabricating a create result inside the client, or by adding a WS04 server. Integrate WS03/production GAME-session behavior against the packet contract above, then rerun `.github/workflows/ws04-character.yml` with that server path.
