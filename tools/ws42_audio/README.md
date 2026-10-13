# WS42 browser audio compatibility tools

These tools inspect and exercise browser-audio compatibility without modifying or substituting Knight Online audio assets.

## Automated tests

```bash
node --test tests/browser-audio/*.test.mjs
```

## Static bundle scan

```bash
node tools/ws42_audio/scan_browser_bundle.mjs openko-web/KnightOnLine.js openko-web/KnightOnLine.html
```

The scan is diagnostic: absence of a marker is reported rather than treated as proof that audio is impossible.

## Manual browser probe

Serve the repository root over HTTP and open `tests/browser-audio/probe.html`. The probe never autoplays audio. Use the explicit **Unlock / resume** action, then provide the URL of an original KO asset to test fetch/decode behavior. Do not point it at replacement or synthetic audio when validating 1298 compatibility.
