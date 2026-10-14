WS12

# Integration Patch / Handoff

WS12 does not modify provider, infrastructure, WS38, server, or client transport ownership outside its assigned paths.

## WS09 — exact MIME alignment required for strict WS38 launcher preflight

Current WS09 `infra/nginx/mime.types` contains:

```nginx
application/javascript               js mjs;
```

Current WS38 `oldko1298.profile.json` declares the real loader as:

```text
KnightOnLine.js -> text/javascript; charset=utf-8
```

Before the strict WS38 staging config is published, the WS09/integration owner must make the HTTP response match the manifest contract. One exact Nginx-compatible approach is:

```nginx
# infra/nginx/mime.types
text/javascript                      js mjs;
```

and ensure UTF-8 is appended for that media type in the staging/production server context, for example:

```nginx
charset utf-8;
charset_types text/javascript application/json text/plain;
```

Then verify externally:

```text
Content-Type: text/javascript; charset=utf-8
```

Do not weaken WS12 `strictContentType` merely to hide this mismatch; either the publisher serves the WS38-declared MIME or WS38 intentionally versions its contract.

## WS09 publisher — staging artifact wiring

For current WS09 staging layout:

- stage `play-shell/**`;
- publish WS38 immutable content under `/client-content/v1/<contentVersion>/`;
- expose the mutable pointer as `/latest.json` (current `config.staging.example.json`), or update `publication.latestUrl` to the actual mutable pointer path;
- preserve `/auth` and `/game` as same-origin WebSocket endpoints;
- use `config.staging.example.json` as staged `play-shell/config.json` for the strict public-test launcher.

## Browser transport boundary

The launcher gateway checks are readiness probes only. They do not rewrite the real C++ `CAPISocket` transport. The published WASM/client package must be the exact integrated build whose auth/game browser transport was proven by WS10 against the staging endpoints. Do not infer client transport correctness from launcher probe PASS alone.

## WS38

No WS38 source patch is requested. WS12 consumes the existing manifest/latest/_complete contract and CI uses WS38's own generator/verifier read-only.
