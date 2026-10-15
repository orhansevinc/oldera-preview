# OldKO 1298 Clan Core (WS21)

Server-side clan/guild domain for the OldKO 1298 target. This module intentionally owns **domain rules only**: it has no packet serializer, no DB migration, no client code, no chat implementation, and no admin/site dependency.

## Public surface

- `ClanService`: create, invite/accept/reject, leave, kick, disband, member listing, online state, role appointments, grade/ranking state.
- `MemoryClanRepository`: transactional in-memory adapter for tests/local integration only.
- `assertClanRepository`: production repository contract expected to be implemented by the persistence workstream.
- `createClanChatDirectory`: read-only WS18 integration surface for resolving clan membership and online recipients.

## Important boundary

`CLAN_PROTOCOL.md` documents verified 1298 protocol facts, but this service does **not** encode or decode `0x3C` packets. Packet ownership must remain in the session/protocol integration layer so WS21 does not invent or fork packet behavior.
