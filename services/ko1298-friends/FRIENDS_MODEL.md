# OldKO 1298 Friends / Block / Messenger model

## Scope

WS32 owns the server-side relationship domain only: friend requests, accept/reject, symmetric friendships, remove, directional block/unblock, friend-list projection, and online/offline presence ports. It deliberately does **not** encode/decode Knight Online packets and does not modify WS18 chat/party code, WS21 clan code, the client, DB migrations, admin, or site code.

## 1298 evidence and conservative limits

The reference source is OpenKO `Open-KO/KnightOnline`, which explicitly targets version 1.298. At commit `7d6cf81093e142c928c2ac9510512b2b182178b5`:

- `src/shared/packets.h` defines the friend process surface as request/report/add/remove. WS32 does not invent additional packet/sub-opcodes.
- `src/Server/Ebenezer/User.cpp`, `CUser::FriendReport()`, reads a signed friend `usercount` and returns immediately when `usercount >= 30 || usercount < 0`.

Therefore `MAX_REPORTED_FRIENDS_1298 = 29` is the largest list size directly accepted by the source-verified report path. WS32 uses 29 as the default domain limit and refuses configuration above 29. This is intentionally documented as a **source-verified report/list bound**, not a claim that every historical client UI exposed exactly 29 visible slots.

No modern messenger features (groups, notes, favorites, rich status, cross-server presence, offline inbox) are implemented because they were not verified for the target patch.

## Domain rules

A friendship is symmetric. A pending friend request is directional. A block is directional, but interaction checks treat a block in either direction as a deny.

Friend request rules:

1. Empty IDs and self requests are rejected.
2. A target lookup port may reject nonexistent users.
3. Existing friendship is rejected as duplicate.
4. Duplicate same-direction pending requests are rejected.
5. A reverse-direction pending request is not auto-accepted; it is reported as `INVERSE_REQUEST_PENDING` because auto-merge behavior was not verified for 1298.
6. Any block in either direction rejects the request.
7. Both users must be below the configured/source-bounded friend limit.

Accept/reject rules:

- Only an existing directional pending request can be accepted or rejected.
- Accept re-checks block and limit state before creating the symmetric friendship.
- Acceptance removes pending requests between the pair.

Block rules:

- Blocking self is invalid.
- Blocking removes an existing friendship and clears pending requests in both directions.
- While either side blocks the other, new friend requests and WS18 private-message checks are denied.
- Unblocking does not recreate a removed friendship or pending request.

## Persistence contract

`FriendRepository` is an adapter interface. WS32 ships `MemoryFriendRepository` for unit tests/reference behavior only. A WS07/PostgreSQL adapter should persist at minimum:

- canonical symmetric friendship pair with canonical uniqueness,
- directional pending friend request with uniqueness,
- directional block with uniqueness.

The production adapter must make relationship mutations atomic and protect friend-limit checks against concurrent accepts/requests. WS32 does not change WS07 migrations.

## Presence contract

`PresenceRegistry` is an in-memory reference implementation and supports multiple sessions per user:

- `login({ userId, sessionId, meta? })`
- `logout({ userId, sessionId })`
- `disconnectUser(userId)`
- `getPresence(userId)`
- `getPresenceMany(userIds)`

A user stays online until the last registered session logs out. `onChange({ userId, online })` fires only on offline->online and online->offline transitions.

## WS18 private-message integration

`FriendsService#createWs18QueryInterface()` exposes:

- `isBlockedEitherWay(leftId, rightId)`
- `canPrivateMessage(fromId, toId)`

1298 whispers are **not made friend-only** by WS32. The query interface only enforces block state. WS18 should call this port before accepting/selecting a private target and before delivery, without importing WS32 persistence internals.

## Packet boundary

WS32 intentionally has no opcode table and no packet codec. The protocol workstream should map verified 1298 friend packets into these domain calls after packet layouts are independently confirmed.
