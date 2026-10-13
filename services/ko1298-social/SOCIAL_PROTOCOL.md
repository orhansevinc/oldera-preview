# OldKO 1298 Social Protocol

## Scope

WS18 implements only the legacy 1298 social server core needed for:

- general/normal chat,
- private target selection and private chat,
- party chat,
- party create/invite/permit/accept/reject,
- party leave/kick/delete,
- disconnect cleanup.

It does not add friends, clan chat, shout/public GM chat, party BBS, combat state, movement, inventory, persistence, or any modern Knight Online social system.

## Primary 1298 references

The implementation was checked against the old KO source in `ko4life-net/ko`:

- `src/server/Ebenezer/PacketDefine.h`
- `src/server/Ebenezer/User.h`
- `src/server/Ebenezer/User.cpp`
- `src/server/Ebenezer/Define.h`
- client-side packet names in `src/game/PacketDef.h`

Reference tree used during WS18 research: `e2028240c7cfc011264cdecbd91baee4e3cdeb29` where exposed by GitHub code search; the same constants are present on `master`.

## Opcodes

| Packet | Value | Legacy meaning |
|---|---:|---|
| `WIZ_CHAT` | `0x10` | User chat |
| `WIZ_PARTY` | `0x2F` | Party-related packet |
| `WIZ_CHAT_TARGET` | `0x35` | Select private-chat target |

Supported chat types:

| Type | Value |
|---|---:|
| `GENERAL_CHAT` | `0x01` |
| `PRIVATE_CHAT` | `0x02` |
| `PARTY_CHAT` | `0x03` |

Supported party subpackets:

| Subpacket | Value |
|---|---:|
| `PARTY_CREATE` | `0x01` |
| `PARTY_PERMIT` | `0x02` |
| `PARTY_INSERT` | `0x03` |
| `PARTY_REMOVE` | `0x04` |
| `PARTY_DELETE` | `0x05` |

All multi-byte integer fields in this module are encoded little-endian, matching the legacy Windows server's `GetShort`/`SetShort` wire behavior.

## Client -> server packet bodies

The transport/session framing is owned by the session server. `SocialService.handlePacket()` expects the already-unframed KO game packet beginning with the opcode byte.

### `WIZ_CHAT (0x10)`

After the opcode:

```text
BYTE   chat_type
WORD   message_length
BYTE[] message
```

Legacy `CUser::Chat()` rejects message lengths `<= 0` or `> 512`. WS18 enforces the same byte-length boundary before routing.

### `WIZ_CHAT_TARGET (0x35)`

After the opcode:

```text
WORD   target_name_length
BYTE[] target_name
```

`MAX_ID_SIZE` is 30 in the referenced Ebenezer `Define.h`. WS18 requires 1..30 bytes and resolves active characters case-insensitively.

### `WIZ_PARTY (0x2F)`

The first body byte is a subopcode.

`PARTY_CREATE` / `PARTY_INSERT`:

```text
BYTE   subopcode
WORD   target_name_length
BYTE[] target_name
```

`PARTY_PERMIT`:

```text
BYTE subopcode
BYTE accepted   // zero = reject, non-zero = accept
```

`PARTY_REMOVE`:

```text
BYTE  subopcode
SHORT member_sid
```

`PARTY_DELETE` has no additional body.

## Server -> client packets emitted by WS18

### Chat delivery

```text
BYTE   WIZ_CHAT (0x10)
BYTE   chat_type
BYTE   sender_nation
SHORT  sender_sid
WORD   display_text_length
BYTE[] display_text
```

For the supported player channels, display text follows the legacy server form:

```text
<sender name> : <message>
```

`GENERAL_CHAT` is **not implemented as a zone-wide broadcast**. The old server routes it through near-region delivery. WS18 therefore delegates recipient discovery to the `nearbyRecipients(session)` integration callback and always includes the sender. This keeps movement/region ownership outside WS18.

`PRIVATE_CHAT` uses the target previously selected by `WIZ_CHAT_TARGET` and sends the chat packet to the target and sender. A stale/offline/self target is rejected safely.

`PARTY_CHAT` is delivered only to accepted members of the sender's current party.

### Private target result

Success:

```text
BYTE   WIZ_CHAT_TARGET (0x35)
WORD   target_name_length
BYTE[] target_name
```

Not found/invalid:

```text
35 00 00
```

### Party permit

```text
BYTE   WIZ_PARTY (0x2F)
BYTE   PARTY_PERMIT (0x02)
SHORT  leader_sid
WORD   leader_name_length
BYTE[] leader_name
```

### Party insert/member snapshot

Accepted party members are represented with the legacy social/UI snapshot shape:

```text
BYTE   WIZ_PARTY (0x2F)
BYTE   PARTY_INSERT (0x03)
SHORT  member_sid
WORD   member_name_length
BYTE[] member_name
SHORT  max_hp
SHORT  hp
BYTE   level
SHORT  class_id
SHORT  max_mp
SHORT  mp
```

WS18 does not calculate combat stats. These fields are pass-through session metadata supplied at registration so the legacy party UI can receive the shape it expects.

Failures use the legacy `PARTY_INSERT` result shape with a signed short. WS18 uses `-1` for generic rejection and `-3` for nation mismatch, matching the old party request behavior.

### Party removal/deletion

Remove:

```text
BYTE  WIZ_PARTY (0x2F)
BYTE  PARTY_REMOVE (0x04)
SHORT member_sid
```

Delete:

```text
BYTE WIZ_PARTY (0x2F)
BYTE PARTY_DELETE (0x05)
```

## Party lifecycle enforced by WS18

- `PARTY_CREATE` creates a leader-owned party and sends the initial invite.
- `PARTY_INSERT` adds an invite to an existing party and is accepted only from the leader.
- Maximum accepted + pending capacity is 8 members.
- A target already in a party or holding a pending invitation is rejected.
- Cross-nation invitation is rejected with legacy result `-3` when both sessions have a nation value.
- `PARTY_PERMIT=0` cancels the pending invite; a just-created leader-only party is cleaned up.
- `PARTY_PERMIT!=0` inserts the invitee and emits legacy member snapshots.
- A member may remove/leave itself.
- Only the leader may kick another member or explicitly delete the party.
- Leader leave/disconnect dissolves the party.
- If a removal leaves only the leader, the party is dissolved, following the old lifecycle behavior.
- Disconnect clears party membership, pending invitation state, and private-target references.

## Validation hooks

`allowChat(session, { type, message })` is the requested flood-control hook. WS18 intentionally does not invent a rate-limit algorithm; the host may reject a message by returning false.

`canPartyTogether(inviter, target)` is an integration validation seam for server policy that depends on live character data (for example a legacy level-range policy). `true` permits; `false` rejects with `-1`; an integer return value is used as the signed legacy party result code. Party lifecycle, capacity, leadership, online-state, and nation checks remain enforced inside WS18.

## Text bytes / charset

The 1298 protocol carries length-prefixed legacy bytes, not UTF-8-tagged strings. Packet codecs therefore preserve `Buffer` values. String convenience paths use `latin1`; production integration should pass the exact legacy `nameBytes` obtained from the game session if a specific Turkish/Windows code page must be preserved byte-for-byte.
