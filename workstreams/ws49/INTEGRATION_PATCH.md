# WS49 Integration Patch

## Goal

Adopt one deterministic test-only fixture vocabulary across service integration/E2E suites without changing production services or production seeds.

## Integration steps

1. Make `packages/oldko-test-fixtures` reachable from the repository's eventual workspace/package manager configuration. WS49 intentionally does not edit root package/workspace files outside its write scope.
2. Integration/E2E harnesses load the required JSON files from `test-scenarios/manifests` and call `validateScenarioManifest()` before use.
3. Consumers call `materializeScenario()` and translate the resulting graph into their own test adapter/API calls. Production domain code must not import WS49.
4. For tests that require real KO 1298 identities, provide a WS31-backed `createCatalogAdapter(ref => resolvedValue)` and enable `strictCatalog: true`.
5. Map WS49 logical refs (for example `zone.moradon`, `nation.karus`, `item.stackable.common`) to WS31 catalog queries/records in the integration harness. Do not replace them with guessed constants.
6. Keep negative scenarios such as `ws49.item.duplicate-serial-negative` isolated to rejection/rollback tests.
7. Keep `osevinc/osevinc` behind development/test context only. Production must fail the credential guard.

## Suggested consumer shape

```js
import {
  createCatalogAdapter,
  materializeScenario
} from "@oldkoweb/test-fixtures";

const catalog = createCatalogAdapter((ref) => ws31.resolveLogicalRef(ref));
const fixture = materializeScenario(scenario, {
  catalogAdapter: catalog,
  strictCatalog: true,
  environment: "test"
});
```

`ws31.resolveLogicalRef` above is illustrative integration code, not a claim about WS31's final public API.

## Ordering / dependency

- WS49 itself is independent of product services and can merge without a WS31 runtime dependency.
- Full real-ID E2E execution is conditional on an integration adapter to WS31 (or an equivalent catalog query facade) being available.
- No DB migration, gameplay implementation, admin/site/client change, main merge, or force push is required by this workstream.
