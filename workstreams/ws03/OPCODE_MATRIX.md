WS03

# Verified KO 1298 gameplay opcode ownership matrix

This matrix contains only opcodes proven by the currently consumed 1298 source/contracts. WS03 deliberately leaves a domain unbound rather than guessing a legacy KO opcode.

| Opcode | Symbol | Inbound owner/routing | Allowed WS03 state | Payload rule used by WS03 | Integration status |
|---|---|---|---|---|---|
| `0x01` | `WIZ_LOGIN` | WS03 | `CONNECTED` | verified credential strings | active |
| `0x02` | `WIZ_NEW_CHAR` | WS03 | `AUTHENTICATED` | existing WS04/WS11 verified create body | active |
| `0x04` | `WIZ_SEL_CHAR` | WS03 -> WS45 -> WS14 | `AUTHENTICATED` | existing verified select body | active |
| `0x05` | `WIZ_SEL_NATION` | WS03 | `AUTHENTICATED` | opcode + nation:u8 | active |
| `0x06` | `WIZ_MOVE` | WS15 | `WORLD_READY` | exactly 9 bytes after opcode | active adapter route |
| `0x09` | `WIZ_ROTATE` | WS15 | `WORLD_READY` | exactly 2 bytes after opcode | active adapter route |
| `0x0C` | `WIZ_ALLCHAR_INFO_REQ` | WS03 | `AUTHENTICATED` | opcode only | active |
| `0x0D` | `WIZ_GAMESTART` | WS14 | `WORLD_LOADING` / `WORLD_READY` | WS14 parser authoritative | active |
| `0x16` | `WIZ_REQ_USERIN` | WS14 | `WORLD_LOADING` / `WORLD_READY` | WS14 parser authoritative | active |
| `0x1D` | `WIZ_REQ_NPCIN` | **WS14/WS16 ownership collision** | `WORLD_LOADING` / `WORLD_READY` | count:u16 + repeated id:u16 when WS16 route explicitly enabled | default remains WS14 |
| `0x20` | `WIZ_NPC_EVENT` | WS16 | `WORLD_READY` | runtime NPC id:u16 | active adapter route |
| `0x22` | `WIZ_TARGET_HP` | WS16 | `WORLD_READY` | target id:u16 + immediate:u8 | active adapter route |
| `0x27` | `WIZ_ZONE_CHANGE` | WS14; WS15 baseline reset follows WS14 snapshot | `WORLD_LOADING` / `WORLD_READY` | WS14 parser authoritative | active |
| `0x2B` | `WIZ_VERSION_CHECK` | WS03 | `CONNECTED` | opcode only | active |

## Deliberately unbound domains

- **WS17 item/inventory:** current WS17 integration contract defines the domain trust boundary but not a verified 1298 inbound opcode/payload mapping. No guessed opcode is registered.
- **WS19 combat/skill:** current WS19 integration contract defines service calls and reason codes but leaves packet parsing to the session/protocol owner. No verified opcode was supplied to WS03 in the consumed contract, so no guessed attack/skill opcode is registered.
- **WS22 economy/trade:** current WS22 integration contract defines authoritative economy calls but not a verified 1298 client opcode mapping. No guessed opcode is registered.
- **WS25 mob, WS26 loot, WS27 progression:** these are downstream results/events, not new inbound WS03 packet ownership. They use the standardized outbound domain-event adapter and still require a verified client encoder before packets can be emitted.

## 0x1D rule

The canonical WS10 Moradon PASS depends on WS14 handling `0x1D` during region/bootstrap detail loading. WS16 independently documents `0x1D` as an NPC router input. WS03 therefore does **not** silently change ownership. Default routing remains WS14. Composition may set `npcRoutesRequestNpcIn: true` only after the central integration owner resolves the WS14/WS16 lifecycle split and proves Moradon regression again.
