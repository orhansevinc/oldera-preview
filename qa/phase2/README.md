# P2-13 independent acceptance gate

P2-13 is an independent release gate. Provider claims, unit tests, fixtures, localhost success, and historical WS10/WS49 evidence are inputs only; none can substitute for real-browser acceptance of the exact P2-00 candidate.

## Evidence model

Every coverage row has five independent dimensions: `source_data`, `implementation`, `runtime_wiring`, `browser_proof`, and `persistence`. A row is overall `PASS` only when every required dimension is `PASS` and every receipt carries the exact candidate fingerprint. Untested rows stay `NOT_RUN`, `UNKNOWN`, or `BLOCKED`.

`LOCAL_VERIFIED` and `DOMAIN_VERIFIED` are separate. Public-domain verification requires the same immutable candidate through all three real hostnames: `oldkoweb.com`, `play.oldkoweb.com`, and `admin.oldkoweb.com`. Host-header/localhost tests are recorded as local evidence only.

## Inputs from P2-00

Pass the final release manifest as `--candidate`. It must pin source, provider SHAs, client JS/WASM/DATA hashes, data/assets, images and DB migration head/order. If any pinned component changes, old evidence is stale and must be rerun for affected rows.

For exhaustive entity coverage, P2-00 should expose `coverage_inventory` arrays in the candidate manifest for maps, NPCs/services/spawn groups, mobs/bosses/spawn groups, classes, skills, effects, item operations, social/PvP features and UI controls. `build-coverage-matrix.mjs` also reads the checked-out `services/ko1298-world/data/zones.1298.json` when present. Missing inventories do not become PASS; they create discovery blockers.

## Controlled accounts

Use only controlled QA accounts/characters. Never delete or reset existing player data. Secrets and passwords must remain in environment variables or an external secret store and must not be written to evidence JSON, screenshots, console dumps or git.

## Run sequence

```bash
node qa/phase2/build-coverage-matrix.mjs \
  --candidate coordination/phase2/FINAL-CANDIDATE.json \
  --out artifacts/phase2-qa/coverage-matrix.json

# Localhost / Host-header path. This can never grant DOMAIN_VERIFIED.
node qa/phase2/run-acceptance.mjs \
  --mode local \
  --candidate coordination/phase2/FINAL-CANDIDATE.json \
  --matrix artifacts/phase2-qa/coverage-matrix.json \
  --out artifacts/phase2-qa/local

# Real public hostnames. Requires Playwright (`npm i -D playwright`) and reachable TLS endpoints.
node qa/phase2/run-acceptance.mjs \
  --mode domain \
  --candidate coordination/phase2/FINAL-CANDIDATE.json \
  --matrix artifacts/phase2-qa/coverage-matrix.json \
  --out artifacts/phase2-qa/domain

node qa/phase2/verify-release-gate.mjs \
  --candidate coordination/phase2/FINAL-CANDIDATE.json \
  --matrix artifacts/phase2-qa/coverage-matrix.json \
  --local artifacts/phase2-qa/local/run.json \
  --domain artifacts/phase2-qa/domain/run.json
```

## Required manual/game receipts

The C++/WASM game UI lives in the canvas, so product interactions must be evidenced by ordered browser/server receipts rather than DOM-only assertions. `run-acceptance.mjs` captures public reachability, browser console/network failures, canvas/WebGL/DPR metrics, screenshots and timing samples. The integrated gameplay, two-client, persistence and admin scenarios remain `BLOCKED` until their scenario receipts are attached to the exact candidate and the coverage matrix is updated. This is intentional: automation availability is not proof of game behavior.

Receipts should include the scenario ID from `acceptance-scenarios.json`, candidate fingerprint, UTC timestamp, controlled account aliases (not passwords), session/correlation/entity IDs, evidence file paths, and a final `PASS|FAIL|BLOCKED` result.

## Release rule

Any critical scenario failure or missing exact-candidate evidence means `RELEASE_BLOCKED`. `DOMAIN_VERIFIED` is granted only when the domain run is exact-candidate matched, all three domains are reachable over valid HTTPS, browser startup completes, critical integrated/game/admin/persistence scenarios pass, and no required coverage row remains untested or blocked.
