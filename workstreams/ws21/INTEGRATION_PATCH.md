# WS21 Integration Patch Notes

WS21 did not modify any other workstream. The following integration work should be performed by the owning streams when they are ready.

## WS07 persistence adapter

Implement the repository contract exported by `services/ko1298-clan/src/repository.js` against the existing account/character/clan persistence layer. Required transactional operations are:

- `transaction(work)`
- `getCharacter(id)` / `saveCharacter(character)` (level, nation, Noah are required by clan creation)
- `getClanById(id)`
- `findClanByNameInsensitive(name)`
- `allocateClanId(nation)` with concurrency-safe allocation
- `createClan(clan)` / `saveClan(clan)` / `deleteClan(id)`
- `getMembershipByCharacter(characterId)`
- `listClanMembers(clanId)`
- `addMembership(membership)` / `updateMembership(membership)` / `removeMembership(characterId)`

Do not duplicate membership state in two stores without a single transaction boundary. Clan name uniqueness should be enforced case-insensitively at the persistence layer too, not only in WS21 service validation.

## WS18 clan chat

Consume `createClanChatDirectory(clanService)` instead of importing WS21 repository details. It exposes only:

- `resolveMember(characterId)` -> clan ID/name/nation/role/duty or null
- `listOnlineRecipients(clanId)` -> online clan character IDs

WS18 remains owner of chat packets, mute/rate limits, message delivery and chat persistence.

## WS14 / WS15 world-session integration

Call `setOnlineState(characterId, true|false)` on session enter/leave and `clearInvitesForCharacter(characterId)` on disconnect.

The historical manager blocks several clan operations in its old `m_bZone > 2` battle-zone test. Do not copy that raw numeric comparison into the browser server. Expose a verified `isBattleZone`/zone-classification contract first, then add a WS21 integration guard in a future patch.

## Session/protocol binding

Bind verified `N3_KNIGHTS (0x3C)` packet sub-operations to WS21 service calls only after packet structs are confirmed by WS11/WS03. `CLAN_PROTOCOL.md` is a reference; WS21 intentionally contains no packet serializer.
