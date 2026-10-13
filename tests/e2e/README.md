# WS10 end-to-end tests

Executable black-box drivers live under `qa/` so the same harness can run locally and in GitHub Actions. This directory is reserved for scenario-specific E2E additions that must not modify product code.

Current entry points:

- `node qa/check-package.mjs .qa-target/client`
- `node qa/run-client.mjs`
- `node qa/run-api.mjs`
- `node qa/finalize.mjs`
