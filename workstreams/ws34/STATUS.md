# WS34 Status

- WS: WS34
- Branch: `ws34-character-rules`
- Base: `main` @ `a1c1d6b3e9aeb07fd066cee8a41714685557dddf`
- Status: COMPLETED
- Test: PASS (`node --test tests/ko1298-character/*.test.js`, 15/15)
- Integration: CONDITIONAL — domain is ready; WS03 packet mapping plus WS07 repository, WS14 spawn, and WS17/item adapters remain external integration work.

## Delivered

- server-authoritative character name validation and 20-byte legacy limit contract;
- duplicate-name repository check plus atomic conflict contract;
- exact three-slot 1298 account rule;
- Karus / El Morad nation ownership validation;
- 7 creation races and 8 base class IDs only;
- exact 14 race/class combinations from 1298 `NewChrValue.tbl`;
- decoded base stats and exact 10-point creation distribution validation;
- face `0..3`, hair `0..2` validation;
- initial level/experience/unspent stat/skill point state;
- spawn and starting-item provider boundaries;
- manipulated request rejection;
- non-destructive delete-character preparation matching the referenced disabled 1298 delete persistence path;
- integration guide and scoped GitHub Actions workflow.

## Scope compliance

Only these WS34-owned paths are changed:

- `services/ko1298-character/**`
- `tests/ko1298-character/**`
- `workstreams/ws34/**`
- `.github/workflows/ws34-character.yml`

No WS03, WS04, WS07, WS14, client, admin/site, migration, main merge, or force-push action was performed.
