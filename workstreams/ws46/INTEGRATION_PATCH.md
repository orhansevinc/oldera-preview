# WS46 Integration Patch

## Consumers

WS03 (packet/session) should translate the verified 1298 `WIZ_DEL_CHAR (0x03)` request into:

```js
{
  accountId,
  characterId,
  slotIndex,
  confirmationKey
}
```

and call `CharacterLifecycleService.deleteCharacter()`.

WS03 remains the owner of byte parsing/encoding and client result mapping.

## Required adapters

### Character repository

Provide:

- `findOwnedCharacter({ accountId, characterId, slotIndex })`
- `runDeleteTransaction(context, callback)`

The transaction unit of work must provide:

- `lockOwnedCharacter(...)`
- `setLifecycleState(...)`
- `releaseCharacterName(...)`
- `deleteCharacter(...)`
- `appendAuditEvent(...)`

No DB migration is part of WS46.

### Confirmation verifier

`verify({ accountId, characterId, confirmationKey }) -> boolean`

The raw legacy key must not be logged or persisted by WS46. The adapter decides how OldKOWeb maps the legacy confirmation field to account security data.

### Session ownership

Bind `sessionGuard` to the authoritative session-ownership implementation:

- `getSelectedCharacterId(accountId)`
- `isCharacterOnline(characterId)`
- `runWithDeleteFence({ accountId, characterId }, callback)`

The fence is required to prevent a new session lease from racing the delete transaction.

### Character-scoped cleanup

Adapters required:

- inventory cleanup
- clan membership cleanup
- friend relation cleanup

All must participate in the same unit of work or equivalent atomic mechanism.

### Inn/warehouse

Do not delete or clear account-scoped Inn/warehouse storage during character deletion.

## Result mapping suggestion for WS03

- `DELETED` -> legacy success byte `0x01` and deleted slot index
- all domain rejection/failure cases -> legacy failure byte (non-`0x01`) and slot `0xFF`

The exact legacy failure-code byte beyond success was not required by the verified client receive path; the client only performs deletion on `0x01`. Do not invent richer legacy wire codes without packet evidence.

## Merge order / compatibility

WS46 can merge independently because it contains only ports/domain code. Before enabling real deletion in production, wire the repository transaction, confirmation verifier, session delete fence, and cleanup adapters. Until those adapters are present, keep the packet route disabled/fail-closed.
