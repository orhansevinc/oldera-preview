# WS39 Read-Only Source Audit

Base snapshot: `main@a1c1d6b3e9aeb07fd066cee8a41714685557dddf`.

Observed completed/partial interfaces used by the registry:

- WS03: `STATUS.md`, `repository.js`; create/select/world bootstrap explicitly incomplete.
- WS07: `INTEGRATION.md`, `services/oldko-data/src/index.js`; no `STATUS.md` exists on the branch.
- WS08: `STATUS.md`, admin repository `REQUIRED_METHODS`; GM execution remains an outbox/bridge dependency.
- WS12: `STATUS.md`, `play-shell/config.json`; availability/version checks exist, integrity manifest does not.
- WS15: `STATUS.md`, `INTEGRATION_PATCH.md`; publishes the WS14 movement requirements.
- WS16: `STATUS.md`, `router.js`, `protocol.js`; NPC event currently resolves only instance identity and zone, with callback seams.
- WS17: `STATUS.md`, `service.js`, `in-memory-repository.js`; owns item state and opens its own owner transaction.
- WS18: `STATUS.md`; friends/block explicitly outside WS18 scope.
- WS19: `STATUS.md`, `INTEGRATION_PATCH.md`, `combat-service.js`; life state is public, mob aggro-policy method is not.
- WS22: `STATUS.md`, `INTEGRATION_PATCH.md`; strict WS16/WS17 adapter requirements published.
- WS23: `STATUS.md`, `INTEGRATION_PATCH.md`; requires verified action, character metadata and in-range NPC interaction.
- WS25: `STATUS.md`, `INTEGRATION_PATCH.md`, `mob-service.cjs`; death is emitted as state change without a stable event-id contract.
- WS26: `STATUS.md`, `INTEGRATION_PATCH.md`; loot creation requires stable `eventId`.
- WS27: `STATUS.md`, `INTEGRATION_PATCH.md`; monster-kill award ingress requires authoritative `xp`.
- WS28: `STATUS.md`, `INTEGRATION_PATCH.md`; canonical typed command bus and translation policy published.
- WS29: `STATUS.md`, `INTEGRATION_PATCH.md`; package complete, product services intentionally untouched.

Parallel branch refresh performed during WS39:

- `ws32-friends-messenger`: advanced to `ahead_by=1` during the audit; STATUS, integration notes and friend/block contracts were re-read and the registry was refreshed.
- `ws33-inn-storage`: advanced to `ahead_by=1` during the audit; STATUS, WS17 item adapter and integration contract were re-read and the registry was refreshed.
- `ws34-character-rules`: branch exists, `ahead_by=0`, no WS34 public contract yet.
- `ws38-client-content-pipeline`: branch exists, `ahead_by=0`, no WS38 public contract yet.
- `ws14-*`: no WS14 branch found.

These are snapshots, not live polling. Future owners must refresh the registry after those branches publish interfaces.
