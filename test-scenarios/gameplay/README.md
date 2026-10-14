# WS49 deterministic gameplay scenarios

This suite is a provider-aware integration harness. It does **not** reimplement provider-owned gameplay.

## Evidence rules

- Provider branch baselines are recorded in `provider-manifest.json`. At run start CI fetches every provider branch, resolves its current HEAD SHA, records drift, and stages **that exact HEAD** for the run.
- A scenario is `PASS` only when its complete claimed path can be executed by a current provider API, or when it is the already-canonical WS10 real-browser gate (scenario A).
- A partial provider-domain proof never upgrades an incomplete product scenario to PASS. It is recorded in the transcript, then the scenario remains `BLOCKED` with the exact missing contract.
- `FAIL` means a path that should be runnable from the tested provider HEADs actually failed.
- Synthetic provider fixtures are allowed only for explicitly labeled domain/stress checks. They are never presented as verified 1298 data.

## Scenario matrix

| ID | Product path | Expected current classification |
|---|---|---|
| A | auth -> login -> nation -> create -> select -> Moradon -> world-ready | PASS, canonical WS10 run #26 + current WS03 preflight |
| B | world-ready -> movement start -> rotate -> move -> stop | PASS, WS15 API |
| C | region crossing -> nearby entity sync | PASS, WS15 verified 48-unit region events/recipients |
| D | NPC appears -> target -> detail -> interaction | BLOCKED: WS16 terrain-Y + dispatcher composition |
| E | merchant open -> buy -> inventory -> sell -> coin | BLOCKED: WS16/31/17 -> WS22 composition |
| F | mob spawn -> combat loop -> death | BLOCKED: WS25 <-> WS19 combat composition + verified mob combat data |
| G | mob death -> drop -> pickup -> inventory | BLOCKED: real drop data + WS25/26/17 production adapters |
| H | XP reward -> level boundary | BLOCKED: verified XP curve/max-level data |
| I | player death -> respawn | BLOCKED: verified respawn resolver + world placement handoff |
| J | zone transition -> target zone world-ready | BLOCKED: generic target-zone transition API/data path |
| K | disconnect/reconnect state restore | BLOCKED: persistence/session/world restore composition |
| L | malformed/replayed packet resilience | BLOCKED: cross-gameplay replay/idempotency policy |
| M | two players see movement broadcast | PASS, WS15 API |
| N | same-loot race | PASS, WS26 concurrent claim guard |
| O | player trade transaction | PASS, WS22 transaction API |

## Run

```bash
NODE_ENV=test node --test tests/test-fixtures/*.test.mjs
node test-scenarios/gameplay/prepare-current-providers.mjs /tmp/ws49-providers
node test-scenarios/gameplay/run-gameplay-scenarios.mjs \
  --provider-root /tmp/ws49-providers \
  --output artifacts/ws49
node test-scenarios/gameplay/reconcile-current-results.mjs \
  --provider-root /tmp/ws49-providers \
  --output artifacts/ws49
```

The generated artifact tree contains `integration-report.json`, `integration-report.md`, provider manifests, one transcript per scenario, and failure/blocker snapshots.
