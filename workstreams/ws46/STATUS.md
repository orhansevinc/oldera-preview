# WS46 STATUS

- WS: WS46
- Branch: `ws46-character-lifecycle`
- Scope: OldKO 1298 Character Delete / Character Lifecycle domain
- Status: COMPLETE
- 1298 delete verified: YES
- Restore/recovery: NOT IMPLEMENTED (no verified 1298 recovery flow)

## Delivered

- `services/ko1298-character-lifecycle/CHARACTER_LIFECYCLE.md`
- repository/cleanup/session/confirmation port based deletion service
- ownership + slot validation
- selected/online rejection and delete fence contract
- 1298 confirmation-key constraint (1..31 bytes)
- lifecycle state transition contract
- transactional cleanup + name release + hard delete + audit boundary
- Inn/warehouse preservation rule
- rollback behavior
- tests
- integration patch notes
- dedicated CI workflow

## Verification summary

Exact Open-KO client source used by the research declares `CURRENT_VERSION = 1298`, `WIZ_DEL_CHAR = 0x03`, and implements the three-slot delete request/response flow in the 1298 character-select code. No character restore/recovery method was found or added.

## Test command

```bash
node --check services/ko1298-character-lifecycle/contracts.js
node --check services/ko1298-character-lifecycle/character-lifecycle-service.js
node --check services/ko1298-character-lifecycle/index.js
node --test tests/ko1298-character-lifecycle/*.test.js
```
