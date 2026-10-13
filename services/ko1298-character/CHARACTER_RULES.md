# OldKO 1298 Character Creation Rules

WS34 is the server-side authority for whether a decoded `WIZ_NEW_CHAR` request is legal. It does not parse packets, render the client, migrate the database, create world sessions, or mint item instances.

## Verified 1298 rules

### Identity and slots

- The Aujard 1298 path reads exactly three account character IDs (`strCharID1..3`), so WS34 exposes slots `0..2` and a maximum of **3 characters per account**.
- Character IDs are backed by `MAX_ID_SIZE = 20` fixed legacy buffers. Creation requires a non-empty name, so the domain boundary is **1..20 encoded legacy bytes**.
- The 1298 client rejects these characters during creation: tilde, backtick, `! @ # $ % ^ & * ( ) - + = | \\ < > , . ? / { [ } ] " '`, and space. `_` is explicitly not blacklisted.
- Server validation also rejects control characters and whitespace variants so a manipulated packet cannot bypass the literal-space client check.
- Duplicate-name detection is repository-backed. The repository/database is responsible for its canonical collation/case semantics and for an atomic uniqueness constraint.

WS03 should pass the original encoded `nameByteLength` from the packet. This avoids pretending UTF-8 character count is the same thing as the legacy client's byte-oriented 20-byte limit.

### Nations, races and creation classes

Nation is read from the account repository and is never trusted from the create request.

| Nation | Race | Race ID | Allowed base classes |
|---|---|---:|---|
| Karus | Arktuarek | 1 | Warrior (101) |
| Karus | Tuarek | 2 | Rogue (102), Priest (104) |
| Karus | WrinkleTuarek | 3 | Wizard (103) |
| Karus | PuriTuarek | 4 | Priest (104) |
| El Morad | Barbarian | 11 | Warrior (201) |
| El Morad | Man | 12 | Warrior (201), Rogue (202), Wizard (203), Priest (204) |
| El Morad | Woman | 13 | Warrior (201), Rogue (202), Wizard (203), Priest (204) |

No mastered/modern class IDs are accepted at character creation. The authoritative compatibility matrix is the set of rows actually present in the 1298 `NewChrValue.tbl` asset, not a later server/database fork.

### Appearance

The 1298 client clamps face to **0..3** and hair to **0..2**. WS34 enforces those same ranges server-side.

### Initial stats

`NewChrValue.tbl` contains the following base values. Every row has exactly **10 creation bonus points**. A request is valid only if every stat is at or above its row base and the sum of all five increases is exactly 10.

| Race / class | STR | STA | DEX | INT | MP | Bonus |
|---|---:|---:|---:|---:|---:|---:|
| Arktuarek / Warrior | 65 | 65 | 60 | 50 | 50 | 10 |
| Tuarek / Rogue | 60 | 60 | 70 | 50 | 50 | 10 |
| Tuarek / Priest | 60 | 60 | 70 | 50 | 50 | 10 |
| WrinkleTuarek / Wizard | 50 | 50 | 70 | 70 | 50 | 10 |
| PuriTuarek / Priest | 50 | 60 | 60 | 70 | 50 | 10 |
| Barbarian / Warrior | 65 | 65 | 60 | 50 | 50 | 10 |
| El Morad Man / any base class | 60 | 60 | 70 | 50 | 50 | 10 |
| El Morad Woman / any base class | 50 | 50 | 70 | 70 | 50 | 10 |

The client refuses to send creation while bonus points remain. WS34 repeats that rule server-side instead of trusting UI state.

### Initial progression

The legacy `USERDATA` schema defaults new characters to:

- level: **1**
- experience: **0**
- unspent stat points (`Points`): **0**
- initial skill-point state: **0** at creation; no create-packet skill allocation exists

WS34 emits these values in the creation record. Later progression belongs to the progression domain.

### Starting zone/spawn and items

Historical create logic uses the account nation as the initial zone and resolves `InitX/InitZ` from zone data. WS34 deliberately does not own world coordinates. `StartingSpawnProvider.resolveStartingSpawn()` is the integration boundary for WS14/world data.

Likewise, starting inventory is delegated to `StartingItemProvider.resolveStartingItems()`. `NewChrValue.tbl` contains 12 item/equipment-looking fields used by the legacy client creation presentation, while later DB implementations also use separate initialization logic. WS34 therefore does **not** invent item IDs or serials; WS17/data integration must supply the authoritative item plan.

### Delete-character preparation

Patch 1298 has `WIZ_DEL_CHAR`, and Aujard parses account, slot, character ID and social-number data, but the referenced implementation leaves the database delete call disabled. WS34 therefore supplies only `prepareDeleteCharacter()` to verify slot ownership/character identity and returns `destructiveDeleteEnabled: false`. Enabling deletion requires a separately verified persistence contract.

## Persistence contract

`CharacterRepository.createCharacter()` must be atomic. Even after the domain's pre-checks it must re-check:

1. account still owns the requested nation/state;
2. selected slot is still empty;
3. account still has fewer than three characters;
4. character name is still globally unique under the database's canonical comparison rules;
5. character row and account-slot link commit together.

Repository race conflicts are mapped back to domain error codes (`DUPLICATE_NAME`, `SLOT_OCCUPIED`, `ACCOUNT_CHARACTER_LIMIT`).

## Sources used

- Open-KO/KnightOnline `src/Client/WarFare/GameProcCharacterCreate.cpp` — create payload, client name blacklist, full bonus-spend requirement.
- Open-KO/KnightOnline `src/Client/WarFare/UICharacterCreate.cpp` — race/class UI matrix, face `0..3`, hair `0..2`, stat editing behavior.
- Open-KO/KnightOnline `src/Client/WarFare/GameProcCharacterCreate.h` — `__TABLE_NEW_CHR` structure and create error model.
- Open-KO/KnightOnline `src/Server/Aujard/AujardApp.cpp` — server create packet fields, three-character account read path, `WIZ_DEL_CHAR` stub.
- Open-KO/KnightOnline `src/shared/globals.h` — nation/race/class identifiers and `MAX_ID_SIZE = 20`.
- ko4life-net/ko-assets branch `1298`, `Data/NewChrValue.tbl` — encrypted 1298 asset; decoded with the table cipher implemented by Open-KO `N3TableBaseImpl.cpp`; 14 rows/base stats/bonus values used by this domain.
- ko4life-net/ko-db `src/schema/USERDATA.sql` — legacy level/experience/stat-point defaults.
- ko4life-net/ko-db `src/procedure/CREATE_NEW_CHAR.sql` — historical nation-to-start-zone behavior. Its later five-slot behavior is intentionally **not** adopted because it conflicts with the 1298 three-slot server path.
