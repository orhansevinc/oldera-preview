# WS10 integration findings

WS10 does not fix product defects. It records reproducible failures and leaves ownership with the relevant workstream.

## BUG-001 — M12 Character selectable has no end-to-end proof

- **Milestone:** M12 (blocks M13-M16)
- **Reproduce:** Run the WS10 client harness against current `openko-browser-port`; complete login -> server list -> version 1298 -> game login -> Nation Select -> Character Select -> Character Create.
- **Expected:** Create a character through the real protocol, refresh/list it, and prove the character is selectable.
- **Actual:** Current proven path reaches the real Character Create scene, but no create-success/list-refresh/selectability evidence is available. WS10 therefore fails M12 and refuses to credit downstream world milestones.
- **Log:** `artifacts/milestones.json`, `artifacts/console.log`, `artifacts/M11-character-create.png`.
- **Likely responsible workstream:** WS04 Character Select/Create (or the session-server workstream if the missing piece is protocol response/persistence).

## Not classified as product bugs yet

M17-M20 are expected to fail until an Admin API/database integration target is supplied. At WS10 branch creation time, `ws07-database` and `ws08-admin-api` still pointed at the same commit as `main`, so there was no independent implementation to test yet.

## Required bug format

Future entries must include: milestone, reproduce, expected, actual, log/artifact, and likely responsible workstream.
