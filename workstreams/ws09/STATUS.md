WS09

# STATUS — Production domain readiness

## Decision

**PRODUCTION TOPOLOGY: READY IN REPO**

**PERSISTENT DEPLOY READY: YES — HOST-AGNOSTIC CONTRACT READY; LIVE HOST TARGET STILL REQUIRED**

**DOMAIN READY: YES — DOMAIN OWNED, RECORD PLAN READY, NO RECORD APPLIED**

**PERSISTENT HOST TARGET: WAITING FOR HOST TARGET**

**DNS CHANGES PERFORMED: NO**

**DEPLOYMENT BLOCKER: PERSISTENT HOST TARGET + IMMUTABLE PRODUCTION IMAGE DIGESTS + CERTIFICATE/CUTOVER EXECUTION**

Branch: `ws09-production-infra`.

This is the existing WS09 workstream. No new workstream was created.

## Latest proven public baseline

The prior stale status said WS10/WS50 were still pending. That is no longer true.

Canonical PASS/rehearsal:

```text
WS10 run               38505039290 / #26 / SUCCESS
WS10 head              f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
PASS artifact          ws10-moradon-e2e-26
client artifact        ws10-moradon-passing-client-26
client artifact id     11867980473
client artifact digest sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3
WS50 READY handoff      9e0fc1822351965755fc490c2d2abf34d40f430d
```

WS09 ephemeral run `38515548307` / #6 at `22254254776293d0f3eed45950011de8742532fc` completed **SUCCESS**. It passed:

- exact PASS/handoff identity gates;
- exact client artifact publication through WS38;
- exact WS02 + integrated WS03/WS14 build;
- public HTTPS;
- launcher + manifest + `_complete` identity;
- strict JS/WASM/DATA MIME/cache contract;
- public `/auth` and `/game` WebSocket `101`;
- WS12 OYNA publication preflight.

The temporary link was intentionally shut down after the 45-minute keepalive. It is evidence, not a persistent URL.

## Production topology implemented

Public:

```text
oldkoweb.com
  -> official static site

play.oldkoweb.com
  -> launcher + immutable WS38 client content
  -> /auth -> gateway-auth -> session-world auth TCP
  -> /game -> gateway-game -> session-world game TCP

admin.oldkoweb.com
  -> admin static frontend
  -> /api/admin/ -> admin-api
```

Private only:

```text
PostgreSQL
admin-api
gateway-auth
gateway-game
session-world :15100/:15001
```

Only Nginx exposes host ports 80/443. Backend network is internal.

## Production hardening prepared

- production Compose mirrors the proven dual-gateway same-origin topology;
- restart policy, health dependency ordering, 30s stop grace;
- Docker JSON log rotation;
- explicit memory/CPU/PID ceilings;
- persistent PostgreSQL volume;
- host release/TLS/backup state contract;
- exact Origin/Host validation on WS02;
- no public API/gateway subdomains;
- no edge CORS;
- unknown Host/SNI rejected;
- TLS 1.2/1.3 termination contract;
- HSTS intentionally deferred until post-cutover validation;
- immutable image-digest requirement;
- exact passing client release metadata frozen in repo;
- atomic static release switch + rollback scripts;
- `.data` byte-range contract;
- credential-free real KO auth binary smoke (`WIZ_SERVER_LIST 0xF5`) plus `/game` upgrade smoke.

## Exact DNS plan

**No DNS changes were performed.**

Initial records after a stable IPv4 host exists:

```text
A      @        WAITING FOR HOST TARGET    DNS-only   TTL 300
CNAME  play     oldkoweb.com               DNS-only   TTL 300
CNAME  admin    oldkoweb.com               DNS-only   TTL 300
CNAME  staging  oldkoweb.com               DNS-only   TTL 300   (optional permanent staging)
```

No `api` or `gateway` public record. No `AAAA` until a stable, tested IPv6 target exists. Full constraints: `workstreams/ws09/DNS_PLAN.md`.

## TLS / HTTPS / WSS

One production SAN certificate is planned for:

```text
oldkoweb.com
play.oldkoweb.com
admin.oldkoweb.com
```

Browser transport remains same-origin:

```text
wss://play.oldkoweb.com/auth
wss://play.oldkoweb.com/game
```

HSTS is absent from initial cutover config by design.

## Rollback

- immutable current/previous static releases;
- atomic symlink switch;
- previous backend image digests retained;
- static rollback dry-run command;
- no automatic destructive DB rollback;
- TTL 300 during DNS cutover for fast record rollback.

## Boundaries

- Domain/registrar/DNS panel untouched.
- No DNS record changed.
- No nameserver changed.
- No certificate issued against the domain.
- No secret committed.
- No main merge.
- No force push.
- No provider gameplay implementation changed.
