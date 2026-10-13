# WS34 Integration Patch

## WS03 -> WS34

WS03 remains the packet/session owner. After decoding `WIZ_NEW_CHAR`, construct a domain request and call `CharacterIdentityService.createCharacter()`.

Required mapping:

```js
await characterIdentityService.createCharacter({
  accountId: session.accountId,
  slot: packet.slot,
  name: packet.characterName,
  nameByteLength: packet.characterNameByteLength,
  race: packet.race,
  classId: packet.classId,
  face: packet.face,
  hair: packet.hair,
  stats: {
    strength: packet.strength,
    stamina: packet.stamina,
    dexterity: packet.dexterity,
    intelligence: packet.intelligence,
    magicPower: packet.magicPower,
  },
});
```

Do not pass a client-authoritative nation. If WS03 decodes one for compatibility, WS34 only accepts it when it equals the repository-owned account nation.

Map `CharacterRuleError.code` to WS03's 1298 wire response; WS34 intentionally contains no packet constants.

## WS07 / persistence adapter

Implement `CharacterRepository` using the persistence layer. `createCharacter()` must be one transaction and must enforce duplicate name + slot/three-character limits at commit time. Use `CharacterRepositoryConflictError` so concurrent creates map to domain errors instead of leaking DB details.

No migration is required or included by WS34.

## WS14 / world integration

Provide `StartingSpawnProvider.resolveStartingSpawn({ nation, race, classId })`. Historical creation selects initial zone from nation; coordinates must come from authoritative zone data/world configuration, not hardcoded WS34 coordinates.

## WS17 / item integration

Provide `StartingItemProvider.resolveStartingItems({ nation, race, classId })`. The provider may use the project data catalog / verified 1298 item initialization source. WS34 does not mint serials or write inventory slots.

## Delete character

`prepareDeleteCharacter()` is safe preparatory validation only. Do not wire it to destructive persistence until the main control line approves a verified 1298 delete contract. The reference Aujard implementation parses `WIZ_DEL_CHAR` but has the DB delete call commented out.

## Error codes intended for adapter mapping

- `ACCOUNT_CHARACTER_LIMIT`
- `INVALID_SLOT`
- `SLOT_OCCUPIED`
- `INVALID_NAME`
- `INVALID_NAME_LENGTH`
- `INVALID_NAME_CHARACTER`
- `DUPLICATE_NAME`
- `INVALID_RACE`
- `INVALID_CLASS`
- `NATION_RACE_MISMATCH`
- `NATION_CLASS_MISMATCH`
- `RACE_CLASS_MISMATCH`
- `INVALID_FACE`
- `INVALID_HAIR`
- `INVALID_STATS`
- `INVALID_STAT_DISTRIBUTION`

Keep exact legacy response-byte mapping in WS03, not in WS34.
