# WS03 KO 1298 protocol notes

Source of truth: `luisfelipe18/old-school-openko` branch `feature/port-posix`, commit `97eb0ea20207afc0c360bfed6915113572711be3`, the same upstream used by the browser-port workflow. No modern KO packet definitions are used.

## Framing
Client `APISocket.cpp` and Ebenezer `User.cpp` agree on an unencrypted frame: `AA 55 | uint16_le payload_length | payload | 55 AA`. Minimum payload is one opcode byte.

## Verified opcode table
| Plane | Opcode | Direction | Verified body |
|---|---:|---|---|
| AUTH | `0xF5` LS_SERVERLIST | C→S/S→C | request opcode only; response `count:u8`, repeated `ip:str16`, `name:str16`, `concurrent:i16` |
| AUTH | `0xF3` LS_LOGIN_REQ | C→S/S→C | request `account:str16,password:str16`; response `result:u8` |
| AUTH | `0xF6` LS_NEWS | C→S/S→C | response `label:str16,content:str16` |
| GAME | `0x2B` WIZ_VERSION_CHECK | C→S/S→C | response begins `version:i16`; upstream server can append JV public key when crypt enabled |
| GAME | `0x01` WIZ_LOGIN | C→S/S→C | request `account:str16,password:str16`; response first byte is nation (`0`, `1`, `2`, `0xFF`) |
| GAME | `0x05` WIZ_SEL_NATION | C→S/S→C | request/response `nation:u8` |
| GAME | `0x0C` WIZ_ALLCHAR_INFO_REQ | C→S | request opcode only; full successful response intentionally not emitted until the complete 1298 character wire record is pinned |
| GAME | `0x02` WIZ_NEW_CHAR | — | opcode verified; body not yet promoted into implementation |
| GAME | `0x04` WIZ_SEL_CHAR | C→S | verified request starts `account:str16,char:str16,init:u8,zone:u8`; response/world bootstrap pending |
| GAME | `0x0D` WIZ_GAMESTART | — | opcode verified; world bootstrap pending WS14 integration |

## Cryptography boundary
The reference Ebenezer version reply includes an 8-byte JV public key and may enable JV cryption afterwards. The browser client compiles this behind `_CRYPTION`. WS03 deliberately does **not** fabricate key material or a crypto mode. Integration must confirm whether the actual WASM build defines `_CRYPTION`; if yes, JV crypto must be implemented before claiming real-client GAME login PASS.
