# WS28 Status

## State

Complete for the scoped GM/Admin command execution boundary.

## Delivered

- server-side typed command registry + runtime argument validation
- explicit actor identity, authentication context, reason and request ID
- authorization interface with no permissive default
- audit metadata validation and fail-closed pre-execution audit
- idempotent execution with concurrent duplicate suppression
- timeout + `AbortSignal`
- structured success, dry-run and failure results
- unavailable downstream service handling
- explicit preview handlers for supported dry-run commands
- adapter interfaces for game operations and moderation/ban operations
- backend allowlist independent from the frontend registry
- no arbitrary shell/system/eval/process command facility
- Node test suite and dedicated GitHub Actions workflow

## Scope intentionally not implemented

- WS08 Admin API changes
- admin frontend changes
- game-domain command implementations
- ban/database persistence
- DB migrations
- client/site changes
- critical legacy commands (`CLEAN`, `ATTACKDISABLE`, `ATTACKENABLE`) without dedicated server contracts

## Verification

Run from repository root:

```bash
node --test tests/gm-command-bus/*.test.cjs
```
