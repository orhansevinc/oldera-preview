WS09

# STATUS — OldKOWeb permanent domain release

## Decision

**C5 GAMEPLAY RELEASE: FROZEN / REAL-BROWSER PROVEN**

**PERMANENT HOST BUNDLE: IMPLEMENTED IN CI**

**LIVE PERMANENT DOMAIN CUTOVER: BLOCKED ON EXTERNAL HOST + PERSISTENCE/ACCOUNT COMPOSITION + WEBSITE HANDOFF**

Branch: `ws09-production-infra`.

No new workstream was created. C5 is immutable and is not modified in place.

## Current canonical gameplay release

```text
FINAL_PROVIDER_SET      WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS50 manifest commit    0d5001095fa3b43693b4fa0cda615f84e2cb7df5
WS50 handoff commit     7497087d4cf67e4e05a3a090f6edad3d206078cb
WS49 run                38600254823 / SUCCESS
WS10 run                38604174659 / SUCCESS
WS10 head               163f2ebf81e750bf746fdaa277695329a0682e22
PASS artifact           ws10-c5-visibility-e2e-4
client artifact         ws10-c5-visibility-passing-client-4
client artifact id      11915666463
client artifact digest  sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

The C5 manifest contains a historical browser baseline field pointing at run #26. That field is not the publication client for this release. Permanent publication must use the newer exact WS10 artifact above, as frozen by the WS50 public handoff.

Release identity file:

`deploy/RELEASE.ws50-c5-ws10-38604174659.env`

## Permanent topology retained

```text
oldkoweb.com
  -> official website
  -> same-origin public account API route supplied by official-site handoff

play.oldkoweb.com
  -> launcher + exact immutable KO1298 client
  -> /auth -> WS02 auth gateway -> session/world
  -> /game -> WS02 game gateway -> session/world

admin.oldkoweb.com
  -> admin frontend
  -> /api/admin/ -> WS08 admin API

private network
  -> PostgreSQL
  -> account/admin/session services
  -> legacy auth/game TCP
```

The existing production Compose already provides private backend networking, restart policies, health ordering, log rotation and a named PostgreSQL volume. The edge exposes only ports 80/443.

## New permanent-release implementation

`.github/workflows/ws09-permanent-release-bundle.yml` now prepares a host-transfer bundle without creating a temporary tunnel. It:

- verifies exact C5, WS49 and WS10 identities;
- verifies the exact live client artifact id/digest;
- downloads the exact real-browser PASS/client artifacts;
- materializes exact frozen WS01/02/03/12/14/38 provider slices;
- republishes the client through the WS38 manifest / `_complete` / `latest.json` contract;
- builds the exact WS02 gateway and integrated WS03+WS14 gameplay images;
- packages production Compose/Nginx/backup/restore/smoke/rollback surfaces;
- emits SHA-256 checksums;
- does **not** claim final domain readiness while external blockers remain.

Canonical machine-readable state:

- `workstreams/ws09/DOMAIN_DEPLOYMENT.json`
- `workstreams/ws09/DOMAIN_RELEASE_REQUESTS.json`

## Live blockers verified from owner workstreams

### Persistent host

No authorized long-running VPS/container host target or stable public IP is available to this WS09 session yet. Domain ownership is not equivalent to owning a server. No paid purchase was started.

### WS03 + WS07

WS07 PostgreSQL 16 foundation is GREEN and publishes `PgWs03SessionRepository`, but current WS03 repository call sites are synchronous while the real PostgreSQL adapter is asynchronous. Production game auth/character persistence therefore is not yet composed into C5.

### WS13 + WS07

WS13 production fails closed without an external repository module. Current WS13 and WS07 also use different persisted account assumptions, including password-hash encoding and fields required for verification/action-token flows. A website-created account cannot yet be honestly claimed to be the same production credential consumed by game login.

### WS08 + WS07

WS08 still requires a WS07-backed adapter matching its production repository surface. MemoryAdminRepository is not accepted for production.

Any change to the C5 gameplay runtime required to integrate persistent auth/session storage must produce a WS50 child candidate and pass the affected contract/scenario/real-browser gates. C5 itself stays unchanged.

## Website handoff

Branch `official-site-domain-release` now exists, but at the last active check the required file:

`coordination/handoffs/official-site-release.json`

was not yet present. WS09 will consume that file when it appears and will not guess the public account route or silently publish an older website artifact.

## DNS / TLS

No DNS record has been changed by this task yet because there is no verified persistent host target and no authoritative DNS-provider connection available here. Existing provider records must be inspected before mutation; unrelated mail/ownership records must be preserved.

Initial intended names remain:

```text
oldkoweb.com
play.oldkoweb.com
admin.oldkoweb.com
```

TLS must cover all three names. Same-origin browser transport remains:

```text
wss://play.oldkoweb.com/auth
wss://play.oldkoweb.com/game
```

## Completion rule

HTTP 200 or WSS 101 alone is not completion. `PERMANENT_DOMAIN_READY=YES` requires the real website/account flow, shared website/game account source, real client login -> character -> Moradon -> movement + C5 NPC/mob visibility, admin authorization, restart persistence and rollback verification on the actual domains.
