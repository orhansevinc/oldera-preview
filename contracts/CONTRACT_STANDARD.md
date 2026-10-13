# OldKOWeb Cross-Service Contract Standard

## 1. Purpose

`contracts/registry.json` is the WS39 source of truth for cross-workstream compatibility. It records provider/consumer ownership, semantic version, required fields/methods, observed public interfaces, compatibility assessment and read-only source references. WS39 never patches a product workstream when a mismatch is found.

## 2. Identity and versioning

Every contract has a stable dotted `id`, `schemaVersion: oldko.contract/v1`, and SemVer `contractVersion` (`MAJOR.MINOR.PATCH`). The registry itself uses `oldko.contract-registry/v1`.

- **MAJOR**: incompatible payload/method/semantic change.
- **MINOR**: backward-compatible additive capability, optional field, or additional result metadata.
- **PATCH**: documentation clarification, implementation fix with unchanged observable contract, or provenance update.

A contract owner must not reuse a version for a different incompatible shape.

## 3. Ownership

The provider owns authoritative output/state semantics. The consumer owns its declared minimum requirements. A composition adapter may rename fields, reorder calls, or translate representation only when it can do so deterministically without creating new authority.

An adapter **may not invent** authentication truth, transaction atomicity, item serial uniqueness, price/XP authority, stable idempotency identifiers, range validation, terrain truth, or verified packet/menu semantics that neither side exposes.

## 4. Compatibility rules

A required contract is **breaking** when any of these occur:

1. provider or required consumer interface is absent;
2. a required method/field is removed or renamed without a declared deterministic adapter;
3. a field type changes incompatibly or its range becomes narrower for already-valid values;
4. optional input becomes required, or required output becomes optional/absent;
5. enum values used by a consumer are removed/reinterpreted;
6. transaction ownership/atomicity changes so one operation can partially commit;
7. authority semantics move to client input or an untrusted/cache-only source;
8. idempotency key guarantees disappear or cannot be derived stably;
9. a previously synchronous/atomic operation becomes eventually applied without an explicit versioned contract;
10. security/validation semantics required by the consumer disappear.

Normally **non-breaking**: adding optional output fields, adding unused enum members, adding new methods, widening accepted input, or implementation-only changes preserving the published contract. Observability adoption is tracked separately because missing telemetry does not change functional payload compatibility, even though it can still block production-readiness policy.

## 5. Interface status

`published` means a public implementation/interface was observed. `partial` means the provider itself documents an incomplete boundary. `branch-empty` means the branch exists but is identical to `main` and publishes no WS-owned interface yet. `missing-branch` means no branch was found. `published-mismatched` means both sides publish interfaces but no compatible composition adapter currently satisfies the required semantics.

## 6. Breaking change detection

`contract-tests/lib/compatibility.cjs` compares normalized field/method descriptors and can detect missing methods, missing fields, conflicting types, requiredness changes, missing semantics and unavailable interfaces. Registry assessments additionally capture semantic conflicts that cannot be inferred from names alone (for example transaction ownership or authoritative-price provenance).

## 7. Change procedure

1. Provider proposes a contract change in its own workstream.
2. Update the registry snapshot/source reference in WS39 or the future integration owner.
3. Run `node --test contract-tests/*.test.cjs`.
4. If breaking, increment MAJOR and coordinate the listed `RECOMMENDED_OWNER_WS` before integration.
5. Never “fix” another workstream from the compatibility branch.

## 8. CI gate

WS39 CI validates registry structure, unique IDs, SemVer, dependency-graph coverage, current breaking-count consistency and synthetic breaking/non-breaking detection cases. The gate does not fetch mutable remote branches during CI; read-only observations are pinned in the registry and must be refreshed explicitly.
