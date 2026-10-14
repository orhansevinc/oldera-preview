# WS49 Status

- Workstream: `WS49`
- Branch: `ws49-test-scenarios`
- Ownership: deterministic test/scenario infrastructure only; **not** gameplay implementation
- State: `SCENARIO SUITE IMPLEMENTED — PROVIDER BLOCKERS EXPLICIT`
- Original deterministic fixture catalog: retained (27 canonical fixture scenarios)
- Provider-aware gameplay scenarios: A through O
- Production provider code changed: **NO**
- Fake provider feature PASS permitted: **NO**

## Canonical relationship to WS10

WS10 remains the canonical real-browser gate. Scenario A consumes the existing canonical WS10 Moradon PASS evidence (run #26 / run id `38505039290`) and pairs it with the current pinned WS03 service-suite preflight. WS49 does not replace or weaken the browser/render gate.

## Provider snapshots

`test-scenarios/gameplay/provider-manifest.json` pins the exact current heads captured for WS03, WS10, WS14, WS15, WS16, WS17, WS19, WS22, WS25, WS26, WS27 and WS31. CI fetches each branch again, records the actual head, reports drift, and stages the pinned commit for deterministic execution.

## Implemented runner guarantees

- deterministic seed and logical time;
- isolated provider snapshots;
- timeout diagnostics;
- per-scenario packet/event transcript;
- PASS / FAIL / BLOCKED status;
- exact provider commits per scenario;
- first failing/blocking event plus expected/actual fields;
- failure/blocker snapshots;
- provider SHA manifest and runtime branch-head manifest;
- machine-readable `integration-report.json`;
- human-readable Markdown report;
- CI artifact upload;
- explicit synthetic-domain labeling.

## Current scenario truth table

- PASS-capable by available provider APIs/evidence: **A, B, M, N, O**.
- BLOCKED by missing production composition/contracts: **C, D, E, F, G, H, I, J, K, L**.
- No blocked scenario is promoted to PASS merely because a provider-domain subtest succeeds.

Exact blocker text is emitted by the runner and included in `failure-snapshots/<scenario>.json`.

## Stress coverage

- 50 movement-session register/disconnect cleanup cycles;
- 100 movement sequences;
- 100 explicitly synthetic WS26 mob-death/loot cycles;
- repeated concurrent same-loot claim races;
- session cleanup verification.

These stress checks state their scope in the report. They do not claim production data fidelity or reconnect-state restoration where providers do not expose it.

## Validation

```bash
NODE_ENV=test node --test tests/test-fixtures/*.test.mjs
node test-scenarios/gameplay/prepare-providers.mjs /tmp/ws49-providers
node test-scenarios/gameplay/run-gameplay-scenarios.mjs \
  --provider-root /tmp/ws49-providers \
  --output artifacts/ws49
```

CI: `.github/workflows/ws49-fixtures.yml` (`WS49 Deterministic Gameplay Scenarios`).
