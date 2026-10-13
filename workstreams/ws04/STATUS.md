# WS04 — Character Select / Character Create client status

## Scope

Client-side only. No gateway/server/database/world-loading implementation is included in this branch.

## Baseline inspected

- start branch: `openko-browser-port`
- inspected head: `18282d0e70de7ccb30244a9f09e2b3bff3040155`
- upstream real client: `luisfelipe18/old-school-openko`, `feature/port-posix`
- genuine assets: `ko4life-net/ko-assets`, branch `1298`
- successful baseline Actions run inspected: `38467739773`

The baseline build already compiles the real `GameProcCharacterSelect.cpp`, `UICharacterSelect.cpp`, `GameProcCharacterCreate.cpp`, and `UICharacterCreate.cpp` into the WASM client. The successful baseline runtime proved:

- login -> server list -> version 1298 -> game login
- real Nation Select
- Nation Select -> real Character Select scene
- genuine `El_CharacterSelect_us.uif` load
- genuine El Morad `ChrSelect` chair/light assets load
- client emits `WIZ_ALLCHAR_INFO_REQ (0x0C)` and receives three protocol-valid empty slots
- empty center slot opens the real Character Create scene
- real 1298 Character Create UIF is visible

The baseline did **not** prove a `WIZ_NEW_CHAR` send, create-success response/list refresh, an occupied character slot, or `WIZ_SEL_CHAR`.

## WS04 changes

`tools/ws04_character/patch_character_client.py`:

- expands the genuine 1298 sparse asset checkout with `Chr/`
- preloads genuine 1298 UPC character-model assets into the Emscripten filesystem
- adds browser-only diagnostics around real all-character parsing, slot action, character-create send/response, and character-select send/response
- does not change packet contents, result interpretation, scene decisions, or desktop behavior

`tools/ws04_character/browser_character_driver.cjs`:

- drives the real 1298 canvas/UI controls
- requires a console proof that the real 0x0C parser ran
- requires non-black Character Select and Character Create compositor evidence
- selects a genuine El Moradian race/class in the real UIF
- requires the center character-preview region to render non-black pixels
- fills a real character name and spends the real bonus points
- clicks the real Create Character button
- requires `WIZ_NEW_CHAR (0x02)` to be emitted by the real client
- automatically continues to create refresh / character select if an integrated session server supplies the required responses

`.github/workflows/ws04-character.yml` is the isolated visual + console gate. It does not publish or modify shared product output.

## Current gate expectation

Client-owned gates are expected to pass through `WIZ_NEW_CHAR` emission. The base GAME stub intentionally has no `0x02`/`0x04` responder, so runtime create-success/list-refresh/character-select remain an integration dependency instead of being faked inside WS04.

See `workstreams/ws04/INTEGRATION_PATCH.md` for the exact server packet contract.

## Runtime evidence

Pending first `ws04-character-client` workflow run. Update this file with the run ID/artifact and exact final gate after CI executes.
