# WS32 integration patch notes

No out-of-scope files were modified.

## WS07 persistence integration required

WS32 exposes `FriendRepository` in `services/ko1298-friends/contracts.js`. A future integration change outside WS32 should provide a PostgreSQL adapter and schema owned by the database workstream for:

- canonical symmetric friendships,
- directional pending friend requests,
- directional blocks,
- uniqueness/transaction rules that make duplicate prevention and friend-limit enforcement race-safe.

WS32 intentionally does not change DB migrations.

## WS18 private-message integration required

WS18 should receive the object returned by `friendsService.createWs18QueryInterface()` as a dependency and call `canPrivateMessage(fromId, toId)` when selecting/validating a private target and again before private-message delivery. A block in either direction must deny the interaction.

No friend-only requirement should be added to whispers; WS32 only contributes block policy.

## Protocol integration required

A protocol workstream should map independently verified 1298 friend packets to WS32 service methods. Do not derive packet layouts from this domain model. The verified OpenKO 1.298 source exposes friend request/report/add/remove concepts, but WS32 intentionally ships no packet codec/opcode constants.
