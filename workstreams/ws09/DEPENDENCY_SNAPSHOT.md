WS09

# Dependency Snapshot — Production domain preparation

## SELF

- Workstream: `WS09`
- Branch: `ws09-production-infra`
- Pre-production baseline head before this work: `22254254776293d0f3eed45950011de8742532fc`.
- Last successful WS09 public ephemeral validation: run `38515548307` / run #6 — **SUCCESS**.
- Last successful WS09 config validation observed before this work: run `38515548191` / run #40 — **SUCCESS**.
- No main merge, force push, DNS change or registrar action.

## CANONICAL PASS / RELEASE

WS50 READY handoff: `9e0fc1822351965755fc490c2d2abf34d40f430d`.

Canonical WS10:

```text
run id             38505039290
run number         26
head                f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
PASS artifact       ws10-moradon-e2e-26
client artifact     ws10-moradon-passing-client-26
artifact id         11867980473
artifact digest     sha256:ff9fb679ad1b3caa184ad098cff81cfb5469b0698d5e5f3b76ef4fab2ea775b3
contentVersion      1298-ws10-38505039290
```

Frozen production-relevant provider refs:

```text
WS01 57d0aa7c6a82810d5f126bda83a368e7eb7801bb
WS02 1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03 237c4a613e94434baae656c1399cb449e7b78067
WS12 121bb7bdb82c364bf9459111096f5ff007873a61
WS14 82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b
WS38 5f323f3cf055ba7f96d928605a2f2faf84e609cb
```

The WS09 public run built those exact WS02 + WS03/WS14 slices, published the exact passing client via WS38, and passed public HTTPS/MIME/WSS + WS12 preflight. The temporary URL was intentionally removed after its 45-minute keepalive.

## WS01

Same-origin browser transport is canonical:

```text
/auth
/game
```

Production maps both only under `play.oldkoweb.com`. Legacy TCP auth/game ports remain private behind WS02.

## WS02

Production uses two gateway instances from the same frozen image: auth mode and game mode. Both require exact Origin and Host allowlists for `https://play.oldkoweb.com` / `play.oldkoweb.com`.

## WS03 + WS14

Production Compose preserves the integrated `session-world` shape proven by WS50. The canonical staging composition is protocol-complete for the browser path. Production durability is not fabricated by WS09; persistent gameplay repository integration remains a provider concern (WS07/WS03).

## WS12 + WS38

Production publishes the exact frozen client through the same immutable content contract:

- JS `text/javascript; charset=utf-8`
- WASM `application/wasm`
- DATA `application/octet-stream`
- immutable version path
- `latest.json` last and no-store.

## WS35 runtime/security config

Observed head: `5327d50906d02c829add08cf1ca73fbe978526dc`.

Relevant contract: typed production config, trusted origins/CORS rules, secret references, production literal-secret rejection and redaction. WS09 uses file-mounted secrets and exact origin/host rules, while avoiding unsupported provider variables.

## WS29 observability

Observed head: `d26f5af7aae0892576af5f35599a9d6076daf129`.

Relevant contract: structured/redacted logs, correlation IDs, health/readiness, metrics and graceful shutdown. WS09 supplies edge/container health and log rotation and leaves service instrumentation to provider integration.

## DOMAIN / HOST

- Domain: `oldkoweb.com` — purchased/owned by the user.
- Persistent host target: **WAITING FOR HOST TARGET**.
- DNS changes performed by WS09: **NO**.
- Required public names: apex, `play`, `admin`.
- Recommended permanent staging name: `staging`.
- Public `api` / `gateway`: not required.

## EPHEMERAL FALLBACK

Known-good fallback evidence remains WS09 public run `38515548307` at branch commit `22254254776293d0f3eed45950011de8742532fc`.

Production infra changes after that frozen publisher revision must not be misrepresented as covered by the old WS50 WS09 freeze. If the Quick Tunnel publisher itself is rerun from a newer infra revision, obtain a matching WS50 re-freeze or use the known-good validated publisher revision.

## BLOCKERS TO LIVE CUTOVER

1. Choose/provision a persistent host with a stable target.
2. Produce/publish immutable image digests for Nginx, Postgres, admin API, WS02, and integrated WS03+WS14 (or build/freeze equivalent images on the host).
3. Obtain the production SAN certificate after the host/DNS challenge path is available.
4. Human-approved DNS cutover.

None of these justify changing DNS tonight.
