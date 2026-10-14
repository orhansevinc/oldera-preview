# OldKOWeb production runbook

This runbook does not authorize DNS changes. Domain-panel work is a separate human-approved cutover step.

## 1. Fresh server provisioning

Recommended baseline: maintained Linux VM/VPS with stable public IPv4.

Install Docker Engine, Compose v2, `curl`, `jq`, OpenSSL and an ACME client. Enable time synchronization and unattended security updates according to the host OS policy.

Firewall:

```text
PUBLIC INBOUND:  TCP 80, TCP 443
ADMIN SSH:       restricted source/VPN/operator policy
DO NOT EXPOSE:   5432, 15100, 15001, 8080 or Docker daemon/socket
```

Only `reverse-proxy` publishes host ports. PostgreSQL, admin API, session-world and both WS02 gateways stay on the Compose internal backend network.

Create host directories:

```sh
mkdir -p deploy/secrets deploy/tls deploy/state deploy/releases deploy/artifacts deploy/backups
chmod 700 deploy/secrets deploy/tls deploy/state deploy/backups
umask 077
openssl rand -base64 36 > deploy/secrets/postgres_password.txt
chmod 600 deploy/secrets/postgres_password.txt
```

Copy `deploy/.env.production.example` to the host-local `deploy/.env.production`. Do not commit it.

## 2. Freeze images and release identities

The application release baseline is `deploy/RELEASE.ws10-38505039290.env`. Client binaries must come from the exact frozen artifact and remain byte-identical.

Before production start, replace every `REQUIRED_*_IMAGE_DIGEST` in the host env with an immutable registry digest:

```text
<registry>/<image>@sha256:<64 hex chars>
```

The WS02 gateway image must represent `1738f60945b24e00bdd2266e6600b5c0cf3c64cf`. The integrated session-world image must represent WS03 `237c4a613e94434baae656c1399cb449e7b78067` + WS14 `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`. Do not substitute a moving `latest`/workstream tag at cutover.

Run:

```sh
sh deploy/validate-production-env.sh deploy/.env.production
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml config --quiet
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml pull
```

That is the deploy dry-run/config gate. It must pass before any service change.

## 3. Stage static releases

Use a release root outside Git-tracked runtime paths, for example:

```text
/opt/oldkoweb/releases/1298-ws10-38505039290/
  site/
  play/
  admin/
```

`play/` must contain the WS12 launcher and the exact WS38 publication:

```text
play-shell/
latest.json
client-content/v1/1298-ws10-38505039290/
  KnightOnLine.js
  KnightOnLine.wasm
  KnightOnLine.data
  manifest.json
  _complete.json
  ...
```

Verify the WS38 manifest before activation. Then dry-run and atomically activate:

```sh
sh deploy/release-switch.sh --dry-run /opt/oldkoweb/releases/1298-ws10-38505039290
sh deploy/release-switch.sh /opt/oldkoweb/releases/1298-ws10-38505039290
```

The proxy mounts the parent artifacts directory, so symlink replacement does not require rebuilding the Nginx image.

## 4. TLS certificate bootstrap

Before production Nginx TLS start, obtain one SAN certificate containing exactly:

```text
oldkoweb.com
play.oldkoweb.com
admin.oldkoweb.com
```

Preferred portable method: ACME. HTTP-01 can use port 80 and `/srv/oldkoweb/acme`; DNS-01 is acceptable when operationally preferred.

Install/mount:

```text
deploy/tls/fullchain.pem
deploy/tls/privkey.pem
```

Permissions must prevent non-operator reads of the private key. Configure automatic renewal and an Nginx reload deploy-hook. Test renewal before enabling long HSTS.

Do not enable HSTS for initial cutover. After HTTPS, renewal and DNS rollback are proven, add a short HSTS max-age; increase deliberately later. `includeSubDomains` only when all relevant subdomains are guaranteed HTTPS.

## 5. Start / restart

Fresh start:

```sh
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml up -d
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml ps
```

Startup order is health-gated:

```text
db -> admin-api
session-world -> gateway-auth + gateway-game
healthy admin/gateways -> reverse-proxy
```

Inspect:

```sh
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml logs --tail=200 \
  reverse-proxy admin-api session-world gateway-auth gateway-game db
```

Restart one service at a time unless the incident requires a full restart:

```sh
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml restart gateway-auth
```

Every app service gets a 30-second Compose stop grace period. Provider implementations should use WS29 draining/graceful-shutdown hooks when integrated.

## 6. Production smoke

After DNS/TLS points at the host:

```sh
sh deploy/production-smoke.sh
```

It checks official/play/admin HTTPS health, launcher availability, non-cacheable `latest.json`, a real byte-range request against `KnightOnLine.data`, and then:

- performs a TLS/WebSocket handshake on `/auth`;
- sends the real credential-free 1298 `WIZ_SERVER_LIST` (`0xF5`) KO binary frame;
- validates a framed `0xF5` response;
- upgrades `/game` without sending a mutating gameplay packet.

No password is read, sent or logged. No real account is mutated.

The canonical full client acceptance remains WS10 run `38505039290`.

## 7. Upgrade

1. Back up DB and verify backup integrity.
2. Materialize the new immutable images and static release.
3. Run config/dry-run validation.
4. Run any WS07-approved forward migration.
5. Activate static symlinks.
6. Recreate only changed backend services with immutable digests.
7. Wait for health after every layer.
8. Reload/recreate reverse proxy last.
9. Run `deploy/production-smoke.sh`.
10. Keep previous images/static release until the observation window closes.

Docker JSON logs rotate at 20 MB x 5 files per service. Export/centralize according to WS29 without packet/password bodies.

## 8. Rollback

Static rollback dry-run:

```sh
sh deploy/rollback-static.sh --dry-run
```

Execute:

```sh
sh deploy/rollback-static.sh
```

Restore previous backend image digests in the host env and recreate only affected services. Then run production smoke.

Do not automatically reverse a database migration or restore an old DB over newer writes. Follow the WS07/WS30 migration and recovery contracts, assess data loss, and take a new backup before any destructive recovery.

## 9. Incident checklist

1. Confirm edge `/healthz`.
2. `docker compose ps` and identify unhealthy dependency.
3. Check rotated logs using request/correlation IDs; never print secrets or WebSocket packet bodies.
4. If static release is bad, switch to previous release.
5. If one backend image is bad, restore prior digest.
6. If certificate is bad, restore prior valid cert and reload Nginx.
7. If origin is healthy but public traffic is bad, bypass any CDN/proxy and test DNS-only origin behavior.
8. If compromise is suspected, isolate host, rotate secrets/certs, preserve logs, then recover from known-good images/releases/backups.

## 10. Certificate incident

Check certificate name, chain and expiry locally before DNS changes. Renewal must write new files atomically and reload Nginx only after `nginx -t` succeeds. Keep the previous certificate until the reload is verified.

## 11. DNS cutover — human approval required

**WS09 does not perform this step automatically.**

Prerequisites:

- stable persistent host target is known;
- host is provisioned and firewalled;
- exact images/static release are staged;
- SAN certificate is ready;
- local/Host-header smoke passes.

Then apply only the records in `workstreams/ws09/DNS_PLAN.md` with TTL 300. Start DNS-only. Validate:

```text
https://oldkoweb.com
https://play.oldkoweb.com/play-shell/
wss://play.oldkoweb.com/auth
wss://play.oldkoweb.com/game
https://admin.oldkoweb.com
```

Run production smoke before raising TTL or enabling a CDN proxy.

## 12. DNS rollback

If cutover fails, restore the previous DNS target while TTL is still 300. Do not delete the new host until old DNS resolution has propagated and sessions are stable. If this is the first production cutover and no previous production target exists, remove/disable the new records and return to the known-good temporary/staging access path.

## 13. Permanent staging

Recommended hostname: `staging.oldkoweb.com`, using the same `/play-shell`, `/auth`, `/game` same-origin topology with a separate staging certificate and staging-only origin allowlist. Protect it with an access policy/VPN/basic-auth layer as operationally appropriate; never reuse production admin credentials.

Quick Tunnel remains fallback/dev. The last proven Quick Tunnel composition is WS09 run `38515548307` at commit `22254254776293d0f3eed45950011de8742532fc`.

## 14. Rate limiting / abuse integration points

Do not invent protocol rate limits in WS09. Integrate WS48/WS02 verified controls at:

- WebSocket handshake admission in WS02;
- login/auth attempt policy;
- admin authentication and mutation endpoints at `/api/admin/`;
- reverse-proxy connection/request limits only after real thresholds are known.

No CORS is enabled by WS09 because all browser APIs/WSS are same-origin.
