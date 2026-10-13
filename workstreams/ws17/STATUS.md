# WS17 Status

**Workstream:** WS17  
**Branch:** `ws17-item-inventory`  
**Scope:** OldKO 1298 item / inventory / equipment domain

## Completed

- Item template registry and real-table adapter boundary
- 64-bit-safe decimal item serial representation
- Stackable / non-stackable validation
- 14 legacy equipment slots
- 28 inventory slots
- 196 inn/warehouse slots
- Equip / unequip
- Inventory, equipment and inn item move/swap
- Stack merge and split with mandatory fresh split serial
- Atomic transaction boundary
- Rollback semantics
- Local and global duplicate serial checks
- Duplicate serial detection hook
- Concurrent same-owner move serialization
- Cross-owner concurrent duplicate-serial protection
- Node built-in test suite
- Dedicated WS17 GitHub Actions workflow

## Explicitly not included

- Database migrations
- Admin UI/API
- Client code
- Combat
- Merchant NPC logic
- Main branch merge
- Modern KO item systems

## Verification

Run:

```bash
node --test tests/ko1298-items/*.test.js
```

Verified locally on Node 20-compatible runtime: **12/12 tests PASS**.
