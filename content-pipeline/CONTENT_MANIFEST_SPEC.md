# OldKOWeb Client Content Manifest Specification — v1

Status: WS38 machine-readable publication and integrity contract for the real 1298 browser package. WS12 may consume this contract later; WS38 does not modify WS12 or client binaries.

## 1. Goals

Every browser package release is treated as one immutable content set. The manifest binds a content/build identity to exact file paths, byte sizes, SHA-256 digests, required/optional status, roles and MIME expectations. Verification must fail closed for missing required files, mixed/stale versions, corruption and incomplete publication.

Primary package files are `index.html`, `KnightOnLine.js`, `KnightOnLine.wasm` and `KnightOnLine.data`. `BUILD.txt` is optional in the supplied profile.

## 2. Release identity

A manifest has:

- `schemaVersion`: contract revision (`1`).
- `contentVersion`: immutable operator-facing content version, e.g. `1298-20261014.1`.
- `buildId`: unique build execution identity, e.g. `gh-4821-a1c1d6b3`.
- `source.commit`: full lowercase 40-character Git commit SHA.
- optional `source.ref`: source branch/tag name.
- `createdAt`: UTC RFC3339 time.

A `contentVersion` MUST NOT be reused for different bytes.

Recommended immutable root:

```text
/client-content/v1/<contentVersion>/
```

Versioned paths are the cache-busting mechanism. Do not rely on query-string cache busting for release identity.

## 3. Manifest contract

`manifest.json` conforms to `content-pipeline/manifest.schema.json`.

Example shape:

```json
{
  "schemaVersion": 1,
  "contentVersion": "1298-20261014.1",
  "buildId": "gh-4821-a1c1d6b3",
  "createdAt": "2026-10-14T01:05:00Z",
  "source": {
    "commit": "a1c1d6b3e9aeb07fd066cee8a41714685557dddf",
    "ref": "openko-browser-port"
  },
  "immutableBasePath": "/client-content/v1/1298-20261014.1/",
  "files": [
    {
      "path": "KnightOnLine.data",
      "size": 87302597,
      "sha256": "<64 lowercase hex>",
      "required": true,
      "role": "data",
      "contentType": "application/octet-stream"
    },
    {
      "path": "KnightOnLine.js",
      "size": 441194,
      "sha256": "<64 lowercase hex>",
      "required": true,
      "role": "loader-js",
      "contentType": "text/javascript; charset=utf-8"
    },
    {
      "path": "KnightOnLine.wasm",
      "size": 5608024,
      "sha256": "<64 lowercase hex>",
      "required": true,
      "role": "wasm",
      "contentType": "application/wasm"
    }
  ],
  "manifestChecksum": {
    "algorithm": "sha256",
    "canonicalization": "oldkoweb-json-v1",
    "value": "<64 lowercase hex>"
  }
}
```

### File fields

`path` is a normalized relative POSIX path; absolute paths, backslashes, `.` and `..` segments are invalid. `size` is exact bytes. `sha256` is SHA-256 of exact bytes. `required: true` means absence is a hard failure. `role` is semantic (`loader-js`, `wasm`, `data`, `html`, `metadata`, `asset`). `contentType` is the expected HTTP MIME contract.

`KnightOnLine.data` is integrity-checked exactly like JS/WASM despite its size. A successful HTTP response or matching filename is not enough; size and SHA-256 must match.

## 4. Manifest checksum

`manifestChecksum.value` is SHA-256 of the canonical manifest payload after removing `manifestChecksum` and optional `signature`.

`oldkoweb-json-v1` canonicalization is UTF-8 JSON with lexicographically sorted object keys, no insignificant whitespace and no non-finite numbers. This checksum protects semantic manifest contents.

`latest.json` also contains `manifestFileSha256`, which is SHA-256 of the exact serialized `manifest.json` bytes. This catches truncation or byte-level transport mutation of the manifest file itself.

## 5. Optional signing interface

SHA-256 gives integrity, not publisher authenticity. Production may add a detached signature over the raw 32 bytes represented by `manifestChecksum.value`:

```json
{
  "signature": {
    "algorithm": "ed25519",
    "keyId": "prod-client-content-2026-01",
    "signedField": "manifestChecksum.value",
    "value": "<base64 detached signature>"
  }
}
```

`tools/ws38_content/manifest.py` exposes `SigningProvider` and `SignatureVerifier` protocol interfaces. Private keys MUST stay outside Git and should come from KMS/HSM/secret storage. WS38 creates no private signing key.

## 6. Partial upload detection and completion marker

Each immutable release SHOULD contain `_complete.json`. It is derived from the final manifest and MUST be uploaded only after all versioned files and `manifest.json` have been uploaded and remotely verified.

Marker shape:

```json
{
  "schemaVersion": 1,
  "contentVersion": "1298-20261014.1",
  "buildId": "gh-4821-a1c1d6b3",
  "publishedAt": "2026-10-14T01:10:00Z",
  "manifestFileSha256": "<sha256 of exact manifest bytes>",
  "manifestChecksum": "<embedded manifest checksum>",
  "fileCount": 5,
  "requiredFileCount": 4
}
```

A release without a valid completion marker MUST NOT be promoted to `latest`. This prevents a half-uploaded version from becoming active.

## 7. `latest.json`

The mutable launcher-facing pointer is small:

```json
{
  "schemaVersion": 1,
  "contentVersion": "1298-20261014.1",
  "buildId": "gh-4821-a1c1d6b3",
  "publishedAt": "2026-10-14T01:11:00Z",
  "manifestPath": "client-content/v1/1298-20261014.1/manifest.json",
  "manifestFileSha256": "<sha256 of exact manifest bytes>",
  "manifestChecksum": "<embedded manifest checksum>",
  "publicationMarkerPath": "client-content/v1/1298-20261014.1/_complete.json"
}
```

Recommended WS12 read sequence:

1. fetch `/client-content/latest.json` with revalidation/no-store;
2. fetch its immutable `manifestPath`;
3. compare exact manifest bytes to `manifestFileSha256`;
4. parse schema v1 and verify embedded `manifestChecksum`;
5. require matching `contentVersion` and `buildId`;
6. in production, fetch and verify `_complete.json`;
7. resolve files via `immutableBasePath + path`;
8. verify required file size + SHA-256 before execution/use;
9. if signature policy is enabled, verify the detached signature before trusting URLs/bytes.

Any mismatch is a hard stale/mixed/corrupt release failure.

## 8. Rollback

A new manifest may optionally carry:

```json
{
  "rollback": {
    "contentVersion": "1298-20261013.4",
    "manifestPath": "client-content/v1/1298-20261013.4/manifest.json",
    "manifestFileSha256": "<previous manifest file sha256>"
  }
}
```

A mutable `/client-content/rollback.json` may also use the same pointer shape as `latest.json`.

Rollback MUST NOT overwrite immutable release files. Re-verify the previous known-good manifest + completion marker, then atomically repoint `latest.json` to that version. Keep at least the previous known-good immutable release.

## 9. CDN/cache policy

Recommended headers:

| Object | Cache-Control |
|---|---|
| `/client-content/v1/<version>/**` | `public, max-age=31536000, immutable` |
| versioned `manifest.json` | `public, max-age=31536000, immutable` |
| versioned `_complete.json` | `public, max-age=31536000, immutable` |
| `/client-content/latest.json` | `no-store, max-age=0` |
| `/client-content/rollback.json` | `no-store, max-age=0` |

Never mutate an object under an immutable URL. Changed bytes require a new `contentVersion`.

## 10. MIME expectations

- `KnightOnLine.wasm` → `application/wasm`.
- `KnightOnLine.data` → `application/octet-stream`.
- `KnightOnLine.js` → `text/javascript; charset=utf-8`.
- `index.html` → `text/html; charset=utf-8`.
- JSON manifest/pointers/markers → `application/json; charset=utf-8`.

Correct WASM MIME is required for reliable WebAssembly streaming behavior in modern browsers. The manifest declares the contract; CDN/origin configuration must actually send it.

## 11. Safe publication order

1. stage client package;
2. generate `manifest.json` from exact staged bytes;
3. run verifier locally;
4. upload files to a brand-new immutable version path;
5. upload immutable `manifest.json`;
6. remotely verify required object presence, sizes and preferably hashes;
7. upload `_complete.json` last;
8. re-fetch and verify manifest + completion marker;
9. atomically replace `latest.json`;
10. retain previous known-good release for rollback.

If anything fails before step 9, leave the previous `latest.json` unchanged. An incomplete unreferenced release is safer than an active mixed release.

## 12. Generator

```bash
python -m tools.ws38_content.generate_manifest \
  --root real1298 \
  --profile content-pipeline/oldko1298.profile.json \
  --content-version 1298-20261014.1 \
  --build-id gh-4821-a1c1d6b3 \
  --source-commit a1c1d6b3e9aeb07fd066cee8a41714685557dddf \
  --source-ref openko-browser-port \
  --output out/manifest.json \
  --publication-marker-output out/_complete.json \
  --cdn-publication-marker-path client-content/v1/1298-20261014.1/_complete.json \
  --latest-output out/latest.json \
  --cdn-manifest-path client-content/v1/1298-20261014.1/manifest.json
```

The generator fails when any required profile file is missing. Optional absent files are omitted from the generated manifest.

## 13. Verifier

```bash
python -m tools.ws38_content.verify_manifest \
  --root real1298 \
  --manifest out/manifest.json \
  --expected-content-version 1298-20261014.1 \
  --publication-marker out/_complete.json \
  --require-publication-marker \
  --latest-pointer out/latest.json
```

Exit codes: `0` pass; `1` integrity/publication failure; `2` CLI/input error.

Representative failures: `MISSING_REQUIRED_FILE`, `SIZE_MISMATCH`, `CHECKSUM_MISMATCH`, `MANIFEST_CHECKSUM_MISMATCH`, `STALE_VERSION`, `LATEST_POINTER_*`, `PUBLICATION_MARKER_*`, `CONTENT_TYPE_CONTRACT_MISMATCH`.

The launcher/publisher must not execute or activate a package after any required integrity failure.
