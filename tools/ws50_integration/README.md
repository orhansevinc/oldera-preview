# WS50 Integration Rehearsal Tool

`rehearse.py` validates whether completed WS branches can be integrated from `main` without touching the source checkout or any remote ref.

## Safety model

- Reads refs and STATUS files from the source checkout.
- Clones the repository locally with `--no-hardlinks` into a temporary directory.
- Copies fetched WS refs into the disposable clone only.
- Performs all sequential merges and static checks only in that disposable clone.
- Refuses to write generated reports inside the source repository.
- Never pushes, rebases, force-updates, or merges into `main`.

## Classification

Every discovered WS branch up to WS49 is classified as one of:

- `cleanly integratable`
- `conflict`
- `blocked dependency`
- `stale branch`
- `missing commit`
- `test failure`

A branch is not treated as completed merely because it exists. It must be ahead of `main` and contain `workstreams/wsNN/STATUS.md`. If STATUS names a commit SHA, that SHA must resolve to a commit that is an ancestor of the branch. If STATUS intentionally omits an explicit SHA, the current branch HEAD is used as the closure candidate and this fallback is recorded in the report.

## WS40

If `ws40-release-readiness` contains a parseable `MERGE_ORDER`, that order is consumed read-only. If the WS40 branch is absent, identical to `main`, or has no parseable order, the tool records that fact and uses numeric WS order as a deterministic fallback.

## Usage

```bash
git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v tools/ws50_integration/test_rehearse.py
python3 tools/ws50_integration/rehearse.py \
  --repo . \
  --output-root /tmp/ws50-rehearsal-output
```

Generated output tree:

```text
/tmp/ws50-rehearsal-output/
├── integration-rehearsal/
│   ├── REHEARSAL_REPORT.md
│   ├── SAFE_BATCHES.md
│   └── FAILED_BRANCHES.md
└── workstreams/ws50/
    └── CONFLICTS.md
```

The canonical copies committed on the WS50 branch are snapshots of a completed rehearsal run; the runner output itself stays outside the source checkout.
