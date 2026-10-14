# WS09 — Persistent production topology

## Canonical release

```text
FINAL_PROVIDER_SET      WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS50 manifest commit    0d5001095fa3b43693b4fa0cda615f84e2cb7df5
WS50 handoff commit     7497087d4cf67e4e05a3a090f6edad3d206078cb
WS49 run                38600254823 / SUCCESS
WS10 run                38604174659 / SUCCESS
WS10 head               163f2ebf81e750bf746fdaa277695329a0682e22
client artifact         ws10-c5-visibility-passing-client-4
client artifact id      11915666463
client artifact digest  sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

The old WS10 run #26/browser-baseline values are historical only. Permanent C5 publication uses the exact newer client above.

## Public topology

```text
Internet
  |
  +-- https://oldkoweb.com
  |      -> Nginx -> exact official-site artifact from official-site handoff
  |      -> same-origin public account API route from official-site handoff
  |
  +-- https://play.oldkoweb.com
  |      -> Nginx -> WS12 launcher + WS38 immutable C5 client content
  |      -> /auth -> WS02 auth gateway -> session/world
  |      -> /game -> WS02 game gateway -> session/world
  |
  +-- https://admin.oldkoweb.com
         -> Nginx -> exact admin frontend
         -> /api/admin/ -> WS08 admin API

private backend network
  -> PostgreSQL
  -> public account service
  -> admin API
  -> session/world
  -> WS02 gateway instances
```

Only Nginx exposes host ports 80/443. PostgreSQL and application TCP ports remain private.

## Persistent host baseline

Portable baseline: maintained Linux VM/VPS, stable public address, Docker Engine + Compose v2, Nginx, ACME TLS, persistent local disk/volume and off-host backup destination. The host is the long-running runtime; GitHub Actions is build/test/package/deploy orchestration only.

Starting capacity for the current single-world early-production load: 4 vCPU, 8 GiB RAM, at least 80 GiB SSD/NVMe. Monitor WS29 metrics and resize from measured CPU/RAM/IO/concurrency rather than guessing future scale.

## Permanent bundle

WS09 run `38609175962` built `ws09-c5-permanent-host-bundle-1` from commit `a0c968e6e09e5b26911ebfb0431c062593ad456c`.

```text
artifact id      11916143558
artifact digest  sha256:dace8c076b51eb70e4dc5196830655a32af17156ee04877402e080faa2a3e3ca
```

The bundle contains the exact C5 client publication, frozen gameplay images, Compose/Nginx contracts, backup/restore/smoke/rollback tooling and SHA-256 checksums. It deliberately does not claim live-domain readiness.

## Static client contract

- `.js/.mjs`: `text/javascript; charset=utf-8`
- `.wasm`: `application/wasm`
- `.data`: `application/octet-stream`
- `.data` byte ranges enabled
- immutable `/client-content/v1/<version>/...`
- `latest.json` no-store and published last
- `_complete` identity must match the activated release

## Persistence status

WS07 PostgreSQL foundation is ready, but production composition is not yet complete:

- WS03 must consume the asynchronous WS07 repository contract instead of the staging/in-memory path.
- WS13 must persist public accounts into the same compatible credential/account source consumed by game authentication, including password-hash and verification/action-token semantics.
- WS08 must replace its in-memory production repository with a WS07-backed adapter.

If persistent game/auth integration changes the C5 runtime provider composition, C5 stays immutable. WS50 must create a child candidate and rerun affected contract/scenario/real-browser gates before production promotion.

## Official-site handoff

WS09 consumes, but does not author, `official-site-domain-release:coordination/handoffs/official-site-release.json`. Until that handoff exists, WS09 does not guess the website artifact or public-account route.

## TLS / DNS

One initial SAN certificate covers apex/play/admin. DNS mutation is allowed by the current permanent-domain task only after the authoritative zone is inspected and a verified persistent host target exists. Unrelated DNS/mail/ownership records are preserved. Initial cutover stays direct/DNS-only with TTL 300 until HTTPS/WSS, browser E2E, restart persistence and rollback are verified.

## Rollback

Keep current + previous static release and immutable backend image identities. Static rollback is an atomic symlink switch; backend rollback restores previous image digests. Database rollback is never automatic.
