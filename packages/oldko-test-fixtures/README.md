# @oldkoweb/test-fixtures

Test-only deterministic fixture primitives for OldKOWeb service integration/E2E tests.

- No production DB seeding.
- No production credentials.
- Synthetic IDs are visibly namespaced as `fx:ws49:*`.
- Synthetic item serials are visibly namespaced as `fxserial:ws49:*`.
- Real KO 1298 IDs are never invented. Logical `$catalog` references stay unresolved until a WS31 catalog adapter is supplied.
- `osevinc/osevinc` exists only behind the explicit `developmentCredential()` development/test guard.

See `test-scenarios/TEST_FIXTURE_STANDARD.md` and `test-scenarios/manifests/*.json`.
