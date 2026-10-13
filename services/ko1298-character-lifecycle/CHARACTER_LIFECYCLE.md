# OldKO 1298 Character Lifecycle / Delete

## Scope

WS46 owns the server-side domain decision for character deletion. It does **not** modify the 1298 packet implementation, character creation, DB migrations, inventory implementation, clan implementation, client, admin, or website.

The service uses ports/repository interfaces only. Production adapters are expected to bind these ports to the owning services and persistence layer.

## 1298 source verification

The delete feature is directly present in the Open-KO 1298 client source:

- `src/Client/WarFare/GameDef.h` at Open-KO commit `7d6cf81093e142c928c2ac9510512b2b182178b5` defines `CURRENT_VERSION = 1298`.
- `src/shared/packets.h` defines `WIZ_DEL_CHAR = 0x03`.
- `src/Client/WarFare/GameProcCharacterSelect.cpp` implements `MsgSend_DeleteChr()` and `MsgRecv_DeleteChr()` for the same 1298 client tree.
- The request is rejected client-side when the confirmation key is empty or has size `>= 32` bytes, so the accepted legacy client range is 1..31 bytes.
- Character positions map to three indices: center `0`, left `1`, right `2`.
- On success, the client accepts result `0x01`, removes the character in the returned slot, and if all three slots are empty it returns to nation select.

Primary source URLs:

- https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Client/WarFare/GameDef.h
- https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/shared/packets.h
- https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Client/WarFare/GameProcCharacterSelect.cpp
- https://github.com/Open-KO/KnightOnline/blob/7d6cf81093e142c928c2ac9510512b2b182178b5/src/Client/WarFare/UIMessageBox.cpp

The Open-KO Aujard source parses the DB-side delete request as account + slot + character + `socNo`, and returns `WIZ_DEL_CHAR`, result, then slot (or `0xFF` on failure). The modernized Open-KO Aujard leaves the actual DB delete call unimplemented, but preserves the original protocol shape. The older upstream-derived server source shows the historical `DELETE_CHAR(account, slot, character, socno, outResult)` stored-procedure call. WS46 uses that only as protocol/history evidence; it does not copy the direct SQL behavior.

Historical server evidence:

- https://github.com/ko4life-net/ko/blob/e2028240c7cfc011264cdecbd91baee4e3cdeb29/src/server/Aujard/AujardDlg.cpp
- https://github.com/ko4life-net/ko/blob/e2028240c7cfc011264cdecbd91baee4e3cdeb29/src/server/Aujard/DBAgent.cpp

## Legacy packet contract

### Client -> game server

`WIZ_DEL_CHAR (0x03)`

1. `uint8 slotIndex` (`0..2`)
2. `int16 characterIdLength`
3. `bytes characterId`
4. `int16 confirmationKeyLength`
5. `bytes confirmationKey`

The source comment calls the confirmation value a resident-registration-number style value (`socNo`). OldKOWeb must treat this field as a legacy confirmation secret. The domain must never log or audit the raw secret.

### DB-agent path

The historical server path prepends session/account context before the slot/name/key fields. The Aujard response contains the session id internally, then `result`, then the deleted slot or `0xFF`. The client-facing response consumed by `MsgRecv_DeleteChr()` is effectively:

1. `uint8 result`
2. `uint8 slotIndexOrFF`

Success is `result == 0x01`.

WS03 remains responsible for packet parsing/encoding. WS46 only exports the protocol constants/shape as an integration contract.

## Domain invariants

1. Account + character + slot ownership must match.
2. Slot is restricted to the real 1298 three-slot model (`0..2`).
3. The legacy confirmation key must be present and be 1..31 bytes.
4. A character selected by the account cannot be deleted.
5. An online character cannot be deleted.
6. A delete fence must be held so a new selected/online session cannot race the deletion transaction.
7. Inventory cleanup, clan cleanup, friend cleanup, name release, character delete, and audit append are part of the same deletion unit of work.
8. Any failure rolls back the whole unit of work.
9. Account-scoped Inn/warehouse storage is not character cleanup and must remain untouched.
10. The confirmation secret is never written to audit data.
11. No restore/recovery API exists in WS46.

## Lifecycle state

`ACTIVE -> DELETE_IN_PROGRESS -> DELETED`

`DELETE_IN_PROGRESS` exists only inside the atomic deletion boundary. `DELETED` is the terminal result/audit state; WS46 does not implement a soft-delete recovery record or restore flow.

## Name release policy

The character name is released only inside the same transaction that deletes the character and only if the transaction commits. If cleanup, audit, or the final delete fails, the transaction rollback must leave the name reserved exactly as before the request.

This matches the hard-delete nature of the verified legacy path without inventing a recovery grace period.

## Cleanup ports

WS46 does not implement other domains. It calls these ports with the same `unitOfWork` so an integration adapter can enlist them atomically:

- `inventoryCleanup.cleanupCharacterInventory(...)`
- `clanCleanup.cleanupCharacterMembership(...)`
- `friendCleanup.cleanupCharacterRelations(...)`

There is deliberately no Inn/warehouse cleanup port in character deletion.

## Atomicity and rollback

`characterRepository.runDeleteTransaction(context, callback)` defines the atomic boundary. The repository adapter must provide a transactional `unitOfWork` with:

- ownership lock/recheck
- lifecycle state update
- name release
- hard character delete
- audit append

Cleanup adapters must use the supplied unit of work or otherwise provide equivalent atomic participation. Throwing from any step aborts the transaction. WS46 converts unexpected failures to `DELETE_FAILED`; callers must not report success unless the transaction committed.

## Session ownership integration

`sessionGuard.runWithDeleteFence()` is required. The production adapter should bind this to the session-ownership/duplicate-login authority so the account/character cannot acquire a new selected or online lease while deletion is committing. WS46 also rechecks selected/online state inside the fence before mutation.
