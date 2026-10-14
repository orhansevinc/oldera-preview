# OldKOWeb permanent production runbook

## 1. Release identity

Use only `deploy/RELEASE.ws50-c5-ws10-38604174659.env` for frozen gameplay identity. The domain release id is `oldkoweb-domain-live-20261015`.

Frozen gameplay authority remains:

```text
WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS10 run 38604174659
WS10 head 163f2ebf81e750bf746fdaa277695329a0682e22
client ws10-c5-visibility-passing-client-4
sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

The newer WS03 persistence work is observation only until WS50 selects a child candidate and WS10 accepts that exact child. Never substitute a newer WS03 head into C5 silently.

Official static authority:

```text
handoff 8370de2ebfdfd319cf8a719da79cbdef9853fd2f
source  5f9a4f0ccd3d7d06e8b407bfca35266f1b2d3516
tree    ee3ba5bfd85ff6951017befb748b71c3e5851f97
```

WS13 account authority is `1ef67bd7c0c98a588bce4db6c0f1305b820af008` with green run `38650301600`; its exact WS07 adapter is commit `1ae85c96319cbab11648a91ed28300e17d4c607f`, blob `022c32abde503a6dc3af1ff9429c206a1b20ca63`.

## 2. Persistent host prerequisite

Required baseline: long-running Linux VM/VPS, stable public IPv4, Docker Engine + Compose v2, public 80/443, private database/game/backend ports, persistent storage, backup destination, and an authorized secure deployment/configuration channel. Do not paste passwords, API tokens, private keys, database URLs or delivery secrets into chat or Git.

Suggested capacity remains 4 vCPU / 8 GiB RAM / >=80 GiB SSD/NVMe; resize from measured metrics.

## 3. Durable candidate

`.github/workflows/ws09-permanent-release-bundle.yml` produces the candidate and publishes it as GitHub prerelease `oldkoweb-domain-live-20261015-candidate`. The prerelease is durable packaging, not production acceptance.

The candidate contains the exact C5 browser client, approved website, admin v10 static tree, WS13+WS07 production account image, frozen C5 gateway/session images, base-image digest snapshot, deployment scripts and SHA256SUMS.

Verify all checksums before staging. Stage releases under an immutable path such as:

```text
/opt/oldkoweb/releases/oldkoweb-domain-live-20261015/
```

## 4. Secure production configuration

Create host-local `deploy/.env.production` from `deploy/.env.production.example`. Populate all immutable image identities and secret-backed inputs through the authorized secret/configuration channel only.

Required account inputs include:

```text
ACCOUNT_DATABASE_URL
OLDKO_ACCOUNT_DELIVERY_WEBHOOK_URL
OLDKO_ACCOUNT_DELIVERY_WEBHOOK_SECRET
```

The delivery URL must be HTTPS. Production WS13 must fail closed if the exact PostgreSQL repository, shared PostgreSQL rate-limit store or real delivery configuration is missing.

Validate before start:

```sh
sh deploy/validate-production-env.sh deploy/.env.production
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml config --quiet
```

## 5. Database backup and migrations

Use the named persistent PostgreSQL volume. Before every production migration, make and verify a backup:

```sh
BACKUP=$(sh deploy/backup-db.sh)
gzip -t "$BACKUP"
```

Then apply only the pinned forward migration target and WS13 rate-limit schema:

```sh
sh deploy/migrate-production-db.sh --env-file deploy/.env.production --backup "$BACKUP"
```

The migration wrapper refuses to run without a valid gzip backup. It targets WS07 through `0003_public_account_api.sql`, then applies the WS13 rate-limit schema. Never automatically reverse database migrations over newer production writes.

Keep an encrypted off-host backup and periodically prove restore in a non-production target with `deploy/restore-db.sh`.

## 6. Production composition gate

Do not cut over while `workstreams/ws09/DOMAIN_RELEASE_REQUESTS.json` contains blocking owner gates.

Required before live:

- WS50 selects and WS10 accepts the persistence-capable game child; frozen C5 itself is not mutated.
- WS08 supplies a real PostgreSQL production repository and real game command bridge; `MemoryAdminRepository` is forbidden in production.
- authorized persistent host, DNS zone access and secure account-delivery configuration are present.

## 7. Static activation and origin start

Dry-run and activate the exact staged static release:

```sh
sh deploy/release-switch.sh --dry-run /opt/oldkoweb/releases/oldkoweb-domain-live-20261015
sh deploy/release-switch.sh /opt/oldkoweb/releases/oldkoweb-domain-live-20261015
```

Firewall policy:

```text
PUBLIC: 80/tcp, 443/tcp
RESTRICTED OPERATOR: SSH/provider console
PRIVATE ONLY: 5432, 15100, 15001, 8080, 8081, Docker socket
```

Start only after all production images/config are resolved:

```sh
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml up -d
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml ps
```

All healthchecks must be green. `account-api` readiness must prove PostgreSQL repository plus shared rate-limit availability.

## 8. Pre-DNS origin verification

Before changing authoritative DNS, verify the real origin IP using Host/SNI overrides for all three names. Required checks include:

- `oldkoweb.com` serves the approved site and `/api/account/...` returns API JSON/status, never SPA HTML fallback;
- `play.oldkoweb.com` serves launcher/client, correct WASM MIME, `.data` range `206`, exact manifest/_complete, and WSS `/auth` + `/game`;
- `admin.oldkoweb.com` serves admin v10 and `/api/admin/...` reaches the real persistent admin service;
- unknown Host/SNI is rejected.

Do not use a temporary tunnel as the permanent target.

## 9. DNS and TLS cutover

Read and export the authoritative zone before mutation. Preserve all existing nameserver, MX, SPF, DKIM, DMARC, CAA, verification and ownership records. Change only the required apex/play/admin records after the origin target is verified; start at TTL 300. Do not invent AAAA without verified IPv6.

Obtain a certificate covering:

```text
oldkoweb.com
play.oldkoweb.com
admin.oldkoweb.com
```

Prove certificate renewal. Do not enable HSTS during the first cutover.

## 10. Real-domain acceptance

Run `deploy/production-smoke.sh`, then WS10 real-browser acceptance. HTTP 200 or WSS 101 alone is not PASS.

Completion requires approved website assets; register/verify/login/dashboard/logout/password change/reset; same PostgreSQL account recognized by game login; launcher exact identity; WSS; login -> character -> Moradon -> NPC/mob -> movement; admin authentication/data/commands; service restart preserving account/character; and application/static rollback proof.

## 11. Restart and rollback proof

Record an account and character, restart application services and PostgreSQL in controlled order, verify the same state persists, reconnect the real browser client, and repeat Moradon/movement smoke.

Keep previous static release and backend image identities. Prove application rollback without destructive database rollback. DNS rollback restores only the pre-cutover apex/play/admin values from the authoritative snapshot while TTL remains low.

## 12. Completion rule

Set `permanent_domain_ready=true` and call the release live only after the three real hostnames, TLS renewal, full account flow, persistent game flow, admin persistent flow, restart persistence, rollback proof and final WS10 domain gate are recorded. The production runtime must survive GitHub Actions, chat and the operator's PC ending.
