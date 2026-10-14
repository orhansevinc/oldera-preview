# WS09 — Persistent production topology

## Decision

Primary recommendation: a maintained Linux VM/VPS with a stable public IP, Docker Engine + Compose v2, Nginx at the edge, and ACME-managed certificates. This keeps the application portable across hosting vendors: the source of truth is Compose, Nginx, release directories and environment/secrets contracts, not a provider-specific PaaS API.

A managed VM/container host with an attached persistent disk is acceptable if it preserves the same contracts. A persistent Cloudflare Tunnel can be used for staging or emergency ingress, but it is not the primary production recommendation because it adds an avoidable edge dependency. Quick Tunnel is development/fallback only.

## Public topology

```text
Internet
  |
  +-- https://oldkoweb.com
  |      -> Nginx -> static official site
  |
  +-- https://play.oldkoweb.com
  |      -> Nginx -> launcher + WS38 immutable client content
  |      -> /auth -> WS02 auth gateway -> WS03/WS14 session-world :15100
  |      -> /game -> WS02 game gateway -> WS03/WS14 session-world :15001
  |
  +-- https://admin.oldkoweb.com
         -> Nginx -> admin static frontend
         -> /api/admin/ -> admin-api
```

No backend TCP service is published. Only Nginx binds host ports 80/443. The Compose backend network is `internal: true`.

No public `api.oldkoweb.com` or `gateway.oldkoweb.com` is needed. Admin stays same-origin and the browser game stays same-origin, so CORS is not enabled at the WS09 edge.

## Quick Tunnel vs production

| Concern | Ephemeral Quick Tunnel | Persistent production |
|---|---|---|
| hostname | random `*.trycloudflare.com` | owned `oldkoweb.com` names |
| lifetime | workflow/process lifetime | host/service lifetime |
| TLS | tunnel edge | owned-domain ACME certificate |
| DNS | none | controlled cutover records |
| release | disposable runner | retained immutable release directories |
| persistence | staging fixtures acceptable | PostgreSQL volume + explicit backups |
| restart | runner cleanup | `restart: unless-stopped`, health ordering |
| rollback | start another run | previous static release + prior image identities |
| observability | job logs | rotated edge logs + WS29 service contract |
| security boundary | staging origin allowlist | exact Host/Origin allowlist and firewall |
| vendor dependency | Cloudflare Quick Tunnel | portable Linux/Docker/Nginx baseline |

Validated Quick Tunnel baseline: WS09 public run `38515548307` at `22254254776293d0f3eed45950011de8742532fc`, using canonical WS10 run `38505039290`. It passed public HTTPS, WS38/MIME, `/auth` + `/game` WebSocket upgrades and WS12 launcher preflight.

## Exact passing client identity

Production must consume the frozen WS10 artifact unchanged:

```text
WS10 run             38505039290
WS10 head            f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
PASS artifact        ws10-moradon-e2e-26
client artifact      ws10-moradon-passing-client-26
artifact id          11867980473
artifact digest      sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3
KnightOnLine.js       1,493,510 bytes
KnightOnLine.wasm     5,631,727 bytes
KnightOnLine.data     615,930,538 bytes
contentVersion        1298-ws10-38505039290
```

WS38 publication order remains:

`immutable files -> manifest -> verify -> _complete -> verify -> latest.json last`.

## Static content contract

- `.js/.mjs`: `text/javascript; charset=utf-8`
- `.wasm`: `application/wasm`
- `.data`: `application/octet-stream`
- `/client-content/v1/<version>/...`: one-year immutable cache
- `/latest.json`, `/rollback.json`, launcher config/index: no-store/no-cache
- `.data` remains a normal Nginx static file with byte ranges enabled and no gzip; production smoke requires `Range: bytes=0-15` -> `206` + valid `Content-Range`.

## Runtime / secret contract

- Image values in the real production env must be immutable `image@sha256:<digest>` identities.
- Provider SHAs and exact client identities are retained in `deploy/RELEASE.ws10-38505039290.env`.
- Passwords, tokens, private keys and database connection secrets never enter Git.
- PostgreSQL password is mounted from a host file through Compose secrets.
- Align service-owned runtime settings with WS35 (`ws35-runtime-config@5327d50906d02c829add08cf1ca73fbe978526dc`) as providers adopt the shared contract. WS09 does not invent unsupported provider variables.
- Align structured logs, redaction, readiness and graceful shutdown with WS29 (`ws29-observability@d26f5af7aae0892576af5f35599a9d6076daf129`). Edge logs contain request metadata, not WebSocket packet bodies/passwords.

## Persistence

Required persistent state today:

- named PostgreSQL volume `oldkoweb_postgres_data`;
- off-host encrypted DB backups;
- host release directories so current + previous client/site/admin bundles survive container recreation;
- host TLS/ACME state.

The exact WS10 passing WS03/WS14 staging composition uses the development/staging repository behavior proven by WS50. WS09 does not falsely claim that this alone supplies production gameplay persistence; use the WS07 production repository adapter when that provider is integrated.

## TLS / HSTS

One initial SAN certificate covers official/play/admin. TLS terminates only at Nginx; backend traffic remains on the private Docker network. TLS 1.2/1.3 only.

HSTS is deliberately absent from the initial production template. Enable in stages only after all required names have valid HTTPS, renewal succeeds and DNS rollback is proven. Start with a short max-age; use `includeSubDomains` only when every relevant subdomain is HTTPS-safe. Do not preload during initial cutover.

## Low-downtime strategy

Static artifacts are release-addressed and activated through atomic symlinks under `deploy/artifacts/{site,play,admin}`. Keep at least the current and previous release. Backend images are immutable. Upgrade one layer at a time, wait for health, then reload the proxy. Rollback switches static symlinks and restores the previous image digests. Database rollback is never automatic.

For true zero-downtime backend replacement, add a second application replica/upstream and drain connections before replacing the first; the single-host Compose baseline is low-downtime, not falsely labeled zero-downtime.
