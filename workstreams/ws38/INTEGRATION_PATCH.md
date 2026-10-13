# WS38 Integration Patch

## Scope boundary

WS38 adds a publication/integrity contract only. It does **not** change WS01 runtime, WS06 asset audit, WS12 launcher, browser/WASM binaries, infrastructure, admin, or site code.

## What integration should consume

WS12 or a future publisher can consume:

- `content-pipeline/manifest.schema.json` — machine-readable manifest schema;
- `content-pipeline/oldko1298.profile.json` — required real 1298 browser package roles;
- `tools/ws38_content.generate_manifest` — release manifest/pointer/marker generation;
- `tools/ws38_content.verify_manifest` — fail-closed integrity verification;
- `content-pipeline/CONTENT_MANIFEST_SPEC.md` — publication, caching, rollback, MIME, and signing contract.

## Publisher integration sequence

The existing browser-package publisher currently stages `index.html`, `KnightOnLine.js`, `KnightOnLine.wasm`, and `KnightOnLine.data`. After staging and before publication, add the equivalent of:

```bash
VERSION="1298-${RELEASE_ID}"
BUILD_ID="gh-${GITHUB_RUN_ID}-${SOURCE_SHA:0:8}"

python -m tools.ws38_content.generate_manifest \
  --root real1298 \
  --profile content-pipeline/oldko1298.profile.json \
  --content-version "$VERSION" \
  --build-id "$BUILD_ID" \
  --source-commit "$SOURCE_SHA" \
  --source-ref openko-browser-port \
  --output out/manifest.json \
  --publication-marker-output out/_complete.json \
  --cdn-publication-marker-path "client-content/v1/$VERSION/_complete.json" \
  --latest-output out/latest.json \
  --cdn-manifest-path "client-content/v1/$VERSION/manifest.json"

python -m tools.ws38_content.verify_manifest \
  --root real1298 \
  --manifest out/manifest.json \
  --expected-content-version "$VERSION"
```

Do not copy this patch into the current publisher blindly: the publisher/CDN owner must map `client-content/v1/...` to the actual origin path and implement upload ordering.

## Required publish ordering

1. upload files under new immutable version path;
2. upload `manifest.json`;
3. verify remote required objects and hashes;
4. upload `_complete.json` last;
5. verify marker + manifest remotely;
6. update mutable `latest.json` only after successful verification.

If any step fails, leave the previous `latest.json` untouched.

## WS12 launcher contract

WS12 should eventually:

1. GET `latest.json` with no-store/revalidation;
2. fetch `manifestPath`;
3. SHA-256 exact manifest bytes and compare with `manifestFileSha256`;
4. validate/parse schema v1 and embedded `manifestChecksum`;
5. require matching `contentVersion` and `buildId`;
6. require/check `_complete.json` in production;
7. construct asset URLs from `immutableBasePath + path`;
8. validate `size` and `sha256` before use;
9. reject stale, missing, corrupt, or mixed-version content;
10. optionally enforce detached signature policy through a trusted public-key verifier.

No WS12 source change is included here.

## CDN policy to apply when infrastructure workstream owns it

- immutable version path: `Cache-Control: public, max-age=31536000, immutable`;
- `latest.json` / `rollback.json`: `Cache-Control: no-store, max-age=0`;
- WASM: `Content-Type: application/wasm`;
- data: `Content-Type: application/octet-stream`;
- JS: `Content-Type: text/javascript; charset=utf-8`;
- JSON: `Content-Type: application/json; charset=utf-8`.

## Rollback

Keep previous immutable version. Roll back by re-verifying its manifest + completion marker and atomically repointing `latest.json`; never overwrite a versioned directory.

## Signing

The code exposes signing/verifier protocol interfaces only. A production KMS/HSM/secret-store implementation may sign `manifestChecksum.value`. No private signing key belongs in this repository.
