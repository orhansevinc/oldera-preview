# WS38 Status

Status: **COMPLETE**

Branch: `ws38-client-content-pipeline`

## Delivered

- Client content manifest v1 contract and JSON Schema.
- Real 1298 package profile for `index.html`, `KnightOnLine.js`, `KnightOnLine.wasm`, `KnightOnLine.data`, and optional `BUILD.txt`.
- Deterministic SHA-256 manifest generator with content/build/source identity.
- Manifest self-checksum with explicit canonicalization.
- Local/staging verifier for missing, corrupt, partial, stale, MIME-contract, pointer, and publication-marker failures.
- Immutable version-path, cache-busting, CDN cache, WASM MIME, and `KnightOnLine.data` integrity rules.
- `latest.json`, `_complete.json`, rollback pointer/manifest design.
- External signing interfaces without a repository private key.
- Unit tests plus CI generator/verifier smoke test.
- WS12/publisher integration notes without modifying WS12.

## Verification

Run:

```bash
python -m unittest discover -s tests/content-pipeline -p 'test_*.py' -v
```

CI also runs a synthetic end-to-end generator + verifier smoke test through `.github/workflows/ws38-content.yml`.

## Integration condition

Ready for integration as a contract/tooling workstream. Actual CDN/origin header configuration and remote upload/promotion ordering belong to the publisher/infra integration owner. WS12 must opt into this manifest contract in its own workstream; WS38 intentionally does not modify WS12.
