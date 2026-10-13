# WS11 Status — COMPLETE

## Scope

WS11 is the independent KO1298 protocol lab and packet replay workstream. It does not implement game-server features.

## Completed

- Pinned the real client reference used by `openko-browser-port`: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`.
- Catalogued all top-level login and game opcodes from the inspected shared enum; unverified direction/size/layout fields are `UNKNOWN`.
- Documented source-verified login-server -> game-server -> nation -> character -> first-zone flow.
- Documented AA55/length/55AA framing and the JvCryption activation boundary.
- Added raw binary fixture format, provenance manifest and a login-to-zone sequence manifest.
- Added strict frame decoder CLI.
- Added C2S-only TCP replay CLI with explicit login/game connection separation.
- Added automated framing, decode, UNKNOWN-policy, manifest-integrity and byte-exact local TCP replay tests.
- Added dedicated WS11 GitHub Actions workflow.

## Write-boundary audit

WS11 changes are restricted to:

- `tools/ws11_protocol/**`
- `protocol-lab/**`
- `tests/protocol-lab/**`
- `workstreams/ws11/**`
- `.github/workflows/ws11-protocol.yml`

No application server, gateway, client/WASM, database, admin or website source is modified.

## Integration requirement

None. The lab is standalone and does not require another workstream to patch product code.
