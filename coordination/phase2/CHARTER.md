# OldKOWeb Phase 2 Integration Charter

Release train: `phase2`
Integration owner: `P2-00` / `phase2/00-integration`
Baseline code commit: `50ecabec15bd358d222a01891ca31359f3a928b0`
Target: existing Windows PC + Docker + PostgreSQL origin serving `oldkoweb.com`, `play.oldkoweb.com`, and `admin.oldkoweb.com`.

## Non-negotiable product baseline

- Keep the accepted website/account design and admin v10 UI unless a user-approved design change is explicitly requested.
- Keep the accepted camera/mouse feel as a regression baseline.
- The game client is the real OpenKO C++ client compiled to WASM/WebGL2. No HTML/DOM game substitute is an acceptable production implementation.
- Do not treat repository `HEAD`, `real1298/BUILD.txt`, a Docker image tag, a WASM artifact, or a database migration head as interchangeable identities.
- Preserve existing user data, secrets, Docker volumes, and local files during update/rollback.
- No paid-server migration is in scope for Phase 2.

## Proven starting identities

The Phase 1 WS50 handoff pins a locally verified persistent account/game/admin composition, but does not claim public-domain verification. Its immutable local package and its source tree are separate from the currently deployed play-client hotfix.

The currently accepted play hotfix freezes WS10 run `38604174659`, artifact `11915666463`, digest `sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83`.

That run rebuilt the real client from:

- OpenKO source: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`
- KO assets: `ko4life-net/ko-assets@2055ee6ed77f1b5cfef23832dd5bc31909e14a66`
- Emscripten: the workflow-recorded toolchain from the accepted run (the older C5 manifest records `6.0.12`; final Phase 2 publication must pin an exact version rather than `latest`).
- Canonical browser patch lineage: WS05/WS04 patch scripts used by the accepted WS10 workflow plus its logging-only visibility patch.

`real1298/BUILD.txt` describes an older `openko-browser-port@18282d0e...` publication and is not the Phase 2 source authority.

## Integration model

Provider branches work in parallel. Common build and publication happen serially through P2-00.

1. P2-01 + P2-02 establish login/session/movement and reproducible load/cache foundations.
2. P2-03 + P2-10 are incorporated into a newly rebuilt C++/WASM client; publishing an old C5 binary after source changes is forbidden.
3. P2-04 + P2-05 + P2-06 establish world/NPC/mob authority and visibility.
4. P2-07 + P2-08 + P2-09 add combat/items/social flows on the same runtime composition.
5. P2-11 supplies ordered persistent migrations and real account/character/admin storage.
6. P2-12 supplies PC update/rollback/diagnostics/backup mechanics.
7. P2-13 independently tests the exact integrated release candidate in a real browser.
8. Only P2-00 composes shared dispatchers, shared C++ entry/build inputs, deploy workflows, edge/runtime composition, and the final release manifest.

A provider is never merged wholesale merely because its branch is green. P2-00 consumes the exact SHA in `coordination/phase2/P2-XX/handoff.json`, reviews the changed paths and dependency contract, and cherry-picks or ports only the required implementation.

## Shared-file rule

The following are integration-owned and must not be concurrently finalized by provider branches:

- `services/ko1298-session/dispatcher.js`
- `services/ko1298-session/production-composition.js`
- `services/domain-live-runtime/**`
- `deploy/domain-live/**`
- `deploy/local-origin/**` release/update composition
- `.github/workflows/*phase2*`, `.github/workflows/publish-openko-real1298.yml`, and replacement Phase 2 publish workflows
- final contents of `real1298/KnightOnLine.js`, `real1298/KnightOnLine.wasm`, `real1298/KnightOnLine.data`, and `real1298/index.html`
- `coordination/phase2/**` global contracts/manifests
- final Phase 2 release manifest and provider-set lock

Providers may propose edits to these surfaces in their handoff; P2-00 performs the final wiring.

## Evidence states

`LOCAL_VERIFIED` means the exact candidate was installed or exercised against the intended local-PC/Docker/PostgreSQL composition with checksums and required tests passing.

`DOMAIN_VERIFIED` means the same immutable candidate was actually exercised through the public `oldkoweb.com`, `play.oldkoweb.com`, and `admin.oldkoweb.com` routes by P2-13 acceptance. A local pass must never be promoted to `DOMAIN_VERIFIED` by inference.

Allowed feature outcomes are `VERIFIED`, `PARTIAL`, `BLOCKED_SOURCE`, `BLOCKED_ASSET`, `BLOCKED_CONTRACT`, and `NOT_INTEGRATED`. Production mocks, fixtures, forwarded-but-not-applied admin commands, synthetic gameplay, and stale binaries cannot satisfy `VERIFIED`.

## Handoff trigger

Each provider writes `coordination/phase2/P2-XX/handoff.json` on its own branch. P2-00 does not poll forever. When the user says all 13 tasks are finished, P2-00 re-reads every branch head and every handoff, resolves exact SHAs, integrates in the order above, rebuilds the client, runs local gates, prepares the checksum-verified PowerShell 5.1 update path, and then coordinates domain acceptance.
