# WS32 status

## Scope

Friends / Block / Messenger relationship domain for OldKO 1298.

## Implemented

- friend request
- accept / reject
- symmetric friend removal
- directional block / unblock
- blocked interaction enforcement
- duplicate and self request rejection
- optional target existence lookup port
- friend list with online/offline projection
- multi-session login/logout presence registry
- repository persistence interface plus in-memory reference adapter
- source-bounded 1298 friend list limit (`29`, because `FriendReport()` rejects `usercount >= 30`)
- WS18 private-message relationship query interface
- unit tests and WS32-only CI workflow

## Deliberately not implemented

- packet/opcode codec or packet layouts
- modern messenger features not verified for 1298
- PostgreSQL schema/migrations
- modifications to WS18, WS21, client, admin or website

## Validation

Run from repository root:

```bash
node --check services/ko1298-friends/contracts.js
node --check services/ko1298-friends/memory-repository.js
node --check services/ko1298-friends/presence.js
node --check services/ko1298-friends/friends-service.js
node --check services/ko1298-friends/index.js
node --test tests/ko1298-friends/*.test.js
```

Expected: all tests pass.
