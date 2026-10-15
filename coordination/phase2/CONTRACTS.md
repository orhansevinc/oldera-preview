# OldKOWeb Phase 2 Contracts

These contracts let provider branches move without waiting for every other provider while keeping final integration reproducible.

## 1. Provider handoff contract

Every provider publishes `coordination/phase2/P2-XX/handoff.json` on its own branch.

Minimum shape:

```json
{
  "schema_version": "oldkoweb-phase2-handoff/v1",
  "owner": "P2-XX",
  "branch": "phase2/XX-name",
  "source_commit": "40-hex-sha",
  "status": "READY|PARTIAL|BLOCKED",
  "changed_files": [],
  "dependencies": [{"owner":"P2-YY","contract":"name/version","required":true}],
  "contracts_provided": [],
  "contracts_consumed": [],
  "tests": [{"command":"...","result":"PASS|FAIL|NOT_RUN","evidence":"..."}],
  "runtime_evidence": [],
  "source_or_asset_gaps": [],
  "shared_file_requests": [],
  "migration_entries": [],
  "notes": []
}
```

`source_commit` must be the exact commit containing the claimed implementation. A moving branch head is never an integration pin.

## 2. Versioned contract rule

A provider may extend an existing interface without waiting for all providers, but it must version the extension in its handoff. Breaking changes require a new contract version. P2-00 may write small adapters/wiring to bridge compatible versions; semantic mismatches are returned to the owning provider and are not hidden by mocks.

Current contract families to preserve unless superseded explicitly:

- KO gateway WebSocket framing and same-origin `/auth` + `/game` routing.
- KO1298 session/auth lifecycle and persistent account/character ownership.
- movement/world region visibility protocol.
- NPC/mob runtime network identity and visibility packet authority.
- combat routing through the real KO1298 session composition.
- PostgreSQL-backed account/admin/game data authority.
- admin command execution must prove application, not merely forwarding/202 acceptance.

## 3. Identity contract

The final release manifest records each identity separately:

- `integration_source_sha`: P2-00 repository source commit.
- `provider_shas`: exact P2-01..P2-13 source commits consumed.
- `openko_source_sha`: exact external OpenKO C++ source commit.
- `client_patch_set`: exact patch/script SHAs or content digests.
- `ko_assets_sha`: exact genuine asset repository commit.
- `asset_manifest_digest`: digest of the staged client asset manifest.
- `emscripten_version`, `cmake_version`, and build flags.
- `client_js_sha256`, `client_wasm_sha256`, `client_data_sha256`.
- `edge_image_id` / digest.
- `runtime_image_id` / digest.
- `db_migration_head` plus ordered migration list.
- `local_package_sha256`.
- `LOCAL_VERIFIED` and `DOMAIN_VERIFIED` as separate booleans/evidence blocks.

No identity may be inferred from another identity.

## 4. Accepted client baseline and rebuild contract

The accepted live-play hotfix currently freezes:

- WS10 run: `38604174659`
- WS10 run head: `163f2ebf81e750bf746fdaa277695329a0682e22`
- client artifact: `11915666463`
- artifact digest: `sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83`
- OpenKO source: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`
- KO assets: `ko4life-net/ko-assets@2055ee6ed77f1b5cfef23832dd5bc31909e14a66`

The accepted WS10 build applied the canonical WS05/WS04 browser, gateway, case, server-list, auth, character, frame-capture and Moradon patches, plus a logging-only visibility-observability patch.

For Phase 2, P2-02/P2-03/P2-10 changes are source changes. P2-00 must rebuild `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data` from the reconciled source+patch+asset set. A release that changes those providers while copying artifact `11915666463` as the final client fails this contract.

The build workflow must pin an exact Emscripten version. `version: latest` is not reproducible enough for the final Phase 2 release even though the accepted WS10 workflow used it; the exact accepted tool version must be recovered from run evidence or a newly approved pinned build must become the Phase 2 authority.

## 5. Database contract

P2-11 owns migration implementation and order. P2-00 consumes the order, does not reorder migrations ad hoc, and records the exact migration head in the final manifest.

The Phase 1 baseline contains shared migrations `database/migrations/0001_init.sql` through `0004_admin_persistence.sql` plus service-owned account migration `services/account-api/sql/0001_postgres_rate_limit.sql`. Phase 2 may extend this sequence, never silently replace already-applied migrations on the user's persistent database.

Any destructive migration requires explicit backup/restore evidence from P2-12 before it can enter the publish candidate.

## 6. Shared runtime composition contract

P2-00 owns final edits to:

- `services/ko1298-session/dispatcher.js`
- `services/ko1298-session/production-composition.js`
- `services/domain-live-runtime/**`
- final Docker/runtime/edge composition

Provider branches expose callable modules/contracts. If a provider needs a dispatcher route, it records opcode/event, request type, response type, state authority, failure semantics, and tests in `shared_file_requests`. P2-00 wires it once after checking collisions.

## 7. Hosting/update contract

P2-12 supplies the mechanisms; P2-00 publishes the final package. If P2-00 has no direct access to the user's Windows PC, it must not claim installation.

The deliverable is one PowerShell 5.1-compatible update entry point that:

1. discovers the existing OldKOWeb install/repo path rather than assuming a fresh machine;
2. validates the release/package checksum before mutation;
3. verifies Docker availability and the expected persistent volumes;
4. backs up the database and release metadata before migration;
5. applies only the pinned release images/assets/migrations;
6. preserves `.env`, secrets, user files and PostgreSQL volumes;
7. runs local health/smoke checks;
8. restores the previous release through a documented rollback path if a mandatory gate fails.

## 8. Verification contract

`LOCAL_VERIFIED` requires evidence for the exact immutable candidate on the intended local composition, including at minimum account login/registration compatibility, game login/character/Moradon entry, movement, persistence/restart, admin read/write authority, client asset checksum validation, and provider-specific tests for included features.

`DOMAIN_VERIFIED` requires P2-13 to exercise the same candidate through all three public domains. Public DNS/tunnel reachability, TLS, same-origin APIs/WebSockets, real browser client startup and representative gameplay/admin flows must be evidenced.

A candidate can be `LOCAL_VERIFIED=true` while `DOMAIN_VERIFIED=false`.

## 9. Feature closure contract

Every final scope row contains: feature, owner, provider SHA, integration state, local evidence, domain evidence, and any missing source/data/assets.

Allowed integration states: `VERIFIED`, `PARTIAL`, `BLOCKED_SOURCE`, `BLOCKED_ASSET`, `BLOCKED_CONTRACT`, `NOT_INTEGRATED`.

Fixtures and mocks may remain in tests, but a production path relying on them cannot be reported as `VERIFIED`.
