# WS18 Status

## State

Implementation complete on `ws18-social-core`.

## Delivered

- Real legacy opcode constants for `WIZ_CHAT`, `WIZ_PARTY`, and `WIZ_CHAT_TARGET`.
- Packet decoding/encoding for normal/private/party chat and the required party subpackets.
- Near-region general-chat routing seam (no fake zone-wide chat channel).
- Private target selection and private-message echo to sender/recipient.
- Flood-control hook and 1..512 byte message validation.
- Party create, invite, permit, accept, reject, leave, kick, delete, eight-member capacity, leadership validation, nation validation, and lifecycle cleanup.
- Disconnect cleanup for party state, pending invites, and private targets.
- Protocol documentation and integration instructions.
- GitHub Actions workflow scoped to WS18 paths.

## Intentionally outside scope

- Combat/stat calculation. Party UI stat fields are pass-through session metadata only.
- Inventory, movement/region implementation, client code, admin, website, persistence/migrations.
- Clan/friend/shout/party-BBS/modern social systems.
- Main-branch merge.

## Verification

Command:

```bash
node --test tests/ko1298-social/*.test.js
```

Local WS18 result before commit: **19 tests, 19 passed, 0 failed**.

Workflow also runs `node --check` over the WS18 service files and then the full WS18 Node test set on Node 20.

## Integration state

The module is integration-ready, with host adapters required for:

- outbound packet send,
- near-region recipient lookup,
- optional flood policy,
- optional live-data party compatibility policy.

See `workstreams/ws18/INTEGRATION_PATCH.md`.
