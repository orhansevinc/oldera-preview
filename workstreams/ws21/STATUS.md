# WS21 Status

## Scope

OldKO 1298 basic Clan / Guild server domain.

## Implemented

- clan creation with verified 1298 level/Noah/nation/name/ID rules;
- Karus and El Morad clan ID allocation ranges;
- runtime invite / accept / reject flow;
- leave, chief-withdraw disband behavior, explicit disband and chief-only kick;
- chief / vice-chief / officer / knight / trainee / punish role vocabulary using the verified 1298 client duty mapping;
- up to three vice-chiefs for the base clan layout;
- chief transfer, vice-chief appointment, officer appointment, punish operation;
- persistent member list plus runtime online/offline presence;
- 24-member structural limit;
- verified 1298 grade calculation and externally supplied ranking value;
- repository interface with no DB migration dependency;
- transactional in-memory repository used for deterministic tests;
- read-only WS18 clan-chat directory interface;
- protocol notes in `services/ko1298-clan/CLAN_PROTOCOL.md`;
- CI workflow `.github/workflows/ws21-clan.yml`.

## Verification

Run from repository root:

```bash
node --test tests/ko1298-clan/*.test.cjs
node --check services/ko1298-clan/src/*.js
```

The tests cover creation, rollback, ID ranges, validation, permissions, nation checks, online invite requirement, accept/reject, full clan limit, role appointments, punish/kick rights, leave/disband, chief transfer, grade thresholds and WS18 chat directory behavior.

## Intentionally not implemented

- packet encoding/decoding or opcodes in production code;
- DB migrations/schema changes;
- WS18 chat transport;
- battle-zone numeric gating until WS14/WS15 expose a verified zone classification contract;
- clan stash;
- alliance/modern clan features;
- invented ranking formula.
