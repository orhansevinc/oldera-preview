# WS18 Integration Patch

## Purpose

This document describes the minimal integration required to attach `services/ko1298-social` to the main 1298 game-session/world stack. WS18 does not modify those owners directly.

## 1. Instantiate once in the game/session host

```js
const { SocialService, OPCODES } = require('../ko1298-social');

const social = new SocialService({
  send(session, packet) {
    // Send one already-built KO game packet through the existing 1298 session transport.
    session.transport.sendGamePacket(packet);
  },
  nearbyRecipients(session) {
    // Return session IDs from the existing world/region visibility layer.
    // GENERAL_CHAT is near-region, not a full-zone broadcast.
    return world.nearbyPlayerSessionIds(session.sessionId);
  },
  allowChat(session, event) {
    // Connect the server's flood policy here. Return false to drop/reject.
    return floodGuard.allow(session.sessionId, event);
  },
  canPartyTogether(inviter, target) {
    // Optional: connect any exact legacy level-range policy owned by character/session data.
    return true;
  },
});
```

The names above are illustrative host adapters only; WS18 does not require those exact host class names.

## 2. Register world-ready player sessions

When a selected character becomes an active game session, register the social identity and party-UI snapshot metadata:

```js
social.registerSession({
  sessionId: session.id,
  sid: session.gameSid,
  name: character.name,
  nameBytes: character.legacyNameBytes,
  nation: character.nation,
  level: character.level,
  classId: character.classId,
  maxHp: character.maxHp,
  hp: character.hp,
  maxMp: character.maxMp,
  mp: character.mp,
  context: session,
});
```

HP/MP/class/level are not calculated by WS18. They are copied into `PARTY_INSERT` packets for the legacy party UI.

## 3. Route only the three owned opcodes

After the existing KO frame/parser has produced a complete game packet, route:

```text
0x10 WIZ_CHAT
0x2F WIZ_PARTY
0x35 WIZ_CHAT_TARGET
```

to:

```js
const result = social.handlePacket(session.id, gamePacket);
```

Do not route transport framing bytes into WS18. The first byte passed to `handlePacket()` must be the KO opcode itself.

## 4. Disconnect ordering

Call:

```js
social.disconnect(session.id);
```

before the host discards all character/session identity needed by social cleanup. This performs the legacy-equivalent party removal/dissolution and clears private-target/pending-invite references.

## 5. Region ownership

WS18 intentionally contains no movement or region implementation. The world/movement owner must provide `nearbyRecipients()`. Do not replace this with “all players in zone” unless protocol evidence for a separate channel requires it; legacy `GENERAL_CHAT` is near-region chat.

## 6. No database migration

Parties, pending invites, private targets, and flood decisions are live-session state only. No WS18 database migration is required or permitted.

## 7. Expected merge surface

Copy/merge only:

- `services/ko1298-social/**`
- `tests/ko1298-social/**`
- `workstreams/ws18/**`
- `.github/workflows/ws18-social.yml`

Then wire the three opcode routes and lifecycle calls in the owner workstream/main integration commit. Those owner-file edits are deliberately not present on `ws18-social-core`.

## Integration acceptance checks

1. Two nearby clients see `GENERAL_CHAT`; a non-nearby same-zone client does not.
2. `WIZ_CHAT_TARGET` success enables private chat; offline/invalid target returns zero-length target response.
3. Party create sends `PARTY_PERMIT`, acceptance emits member inserts, and `PARTY_CHAT` reaches party members.
4. Non-leader kick/delete is rejected server-side.
5. Leader disconnect dissolves the party; member disconnect removes the member without stale state.
6. A >512-byte chat packet is rejected before broadcast.
7. Flood callback false produces no chat delivery.
