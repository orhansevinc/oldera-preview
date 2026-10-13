# OldKOWeb production runbook

## 1. Prepare host

Use a maintained Linux host with Docker Engine + Compose v2. Open inbound TCP 80/443 only. Keep PostgreSQL, KO session and Admin API unexposed to the public internet.

Copy `deploy/.env.example` to `.env` and replace image tags with immutable release tags/digests. Keep `NGINX_TEMPLATE=local.conf.template` until domain/DNS/TLS are real.

Create the database secret:

```sh
umask 077
openssl rand -base64 36 > deploy/secrets/postgres_password.txt
```

Stage finished static outputs under `deploy/artifacts/site`, `deploy/artifacts/play` and `deploy/artifacts/admin`.

## 2. Validate before start

```sh
sh deploy/verify-config.sh
docker compose --env-file .env -f docker-compose.ws09.yml config --quiet
docker compose --env-file .env -f docker-compose.ws09.yml pull
```

Confirm backend images implement the WS09 interface contract in `deploy/env/README.md`. Run DB migrations from the WS07-approved migration mechanism before exposing traffic.

## 3. Start and inspect

```sh
docker compose --env-file .env -f docker-compose.ws09.yml up -d
docker compose --env-file .env -f docker-compose.ws09.yml ps
docker compose --env-file .env -f docker-compose.ws09.yml logs --tail=200 reverse-proxy admin-api gateway ko-session db
```

In local mode, map the `*.oldkoweb.local` names to the host in `/etc/hosts` or send explicit Host headers. Verify official/admin/play HTML, Admin API health and a WebSocket upgrade through `/ws`.

## 4. Database backup

Run at least daily and before every migration/deploy:

```sh
sh deploy/backup-db.sh
```

Copy backups off-host to encrypted storage with retention such as 7 daily + 4 weekly + 6 monthly. A backup is not accepted until `gzip -t` succeeds and a periodic restore drill works.

Restore requires an explicit `RESTORE` confirmation:

```sh
sh deploy/restore-db.sh deploy/backups/<backup>.sql.gz
```

## 5. Domain cutover

Only after `oldkoweb.com` is purchased:

1. Provision the production host/load balancer and obtain its stable public IP/hostname.
2. Add the DNS records from `DNS_PLAN.md` with temporary 300-second TTLs.
3. Obtain certificates for the enabled hostnames and place/mount them as `fullchain.pem` + `privkey.pem` under `TLS_CERT_DIR`.
4. Change `.env` hosts to real domains, set `NGINX_TEMPLATE=production.conf.template`, then run `nginx -t`/Compose validation and restart only the reverse proxy.
5. Verify HTTPS, Admin API authentication, browser `.wasm/.data` MIME/cache headers and a real `wss://play.oldkoweb.com/ws` session before raising TTLs.

## 6. Deployment policy

Prefer immutable image tags/digests and release-addressed client assets. Deploy one layer at a time: database migrations, backend services, static client/admin/site, then proxy changes. Keep the previous image tags and static release directory for immediate rollback.

## 7. Rollback

If application code fails but schema is backward compatible, restore prior image tags/static release and recreate affected containers. Database rollback should use WS07 migration guidance; do **not** automatically restore a DB backup over newer production writes unless data-loss impact is understood.

## 8. Security follow-up

- Keep Docker socket unavailable to app containers.
- Run containers as non-root when each service image supports it.
- Rate-limit login/admin mutation endpoints in the API or edge layer.
- Restrict admin access further with MFA/VPN/IP policy if operationally practical.
- Move CSP from Report-Only to enforced after violations are resolved.
- Keep `api`/`gateway` DNS records absent if dedicated public hosts are not needed.
