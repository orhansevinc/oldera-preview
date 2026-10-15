# WS39 domain-live contract gate

Generic validator for `oldkoweb-domain-live-20261015` owner handoffs. It does not select a provider set and does not freeze moving branch heads.

Run after the owners publish their exact handoffs:

```bash
node tools/ws39_contracts/domain_live.cjs \
  --release oldkoweb-domain-live-20261015 \
  --root coordination/handoffs/domain-live \
  --out artifacts/ws39-domain-live.json
```

The default source check verifies each immutable `source_commit` exists and is an ancestor of its declared owner branch. The observed branch head is evidence only: it is never inserted into the pin digest. A newer docs-only head is therefore harmless when the pinned source commit remains in branch history.

Output includes exact source pins, deterministic contract/pin digests, compatibility matrix, open/closed blockers, stale blockers marked `SUPERSEDED_BY_PROVIDER_EVIDENCE`, required consumer reconciliation, blocker classes, and missing external gates. `valid=true` is deliberately stricter than “tooling works”: it requires no open/reconciliation/source/schema/compatibility gate. The tooling itself reports `READY_TO_FREEZE_AFTER_OWNER_COMPLETION` and `final_set_frozen=false`.
