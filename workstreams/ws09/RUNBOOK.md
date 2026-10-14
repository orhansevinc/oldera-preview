# OldKOWeb permanent production runbook

## 1. Release identity

Use only:

`deploy/RELEASE.ws50-c5-ws10-38604174659.env`

Canonical C5 client:

```text
WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS10 run 38604174659
WS10 head 163f2ebf81e750bf746fdaa277695329a0682e22
client ws10-c5-visibility-passing-client-4
sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

Do not substitute the historical run #26 client.

Host bundle produced by WS09 run `38609175962`:

```text
ws09-c5-permanent-host-bundle-1
artifact id 11916143558
sha256:dace8c076b51eb70e4dc5196830655a32af17156ee04877402e080faa2a3e3ca
```

Verify the bundle digest/checksums before staging.

## 2. Persistent host prerequisite

Required baseline: Linux VM/VPS, stable public target, Docker Engine + Compose v2, 80/443 reachable, application/database ports private, persistent disk/volume, backup destination and operator access through a secure provider/SSH path. Do not paste passwords/private keys into chat or Git.

Suggested initial capacity: 4 vCPU / 8 GiB RAM / >=80 GiB SSD/NVMe. Resize from measured WS29 metrics.

## 3. Host directories and secrets

```sh
mkdir -p deploy/secrets deploy/tls deploy/state deploy/releases deploy/artifacts deploy/backups
chmod 700 deploy/secrets deploy/tls deploy/state deploy/backups
umask 077
openssl rand -base64 36 > deploy/secrets/postgres_password.txt
chmod 600 deploy/secrets/postgres_password.txt
cp deploy/.env.production.example deploy/.env.production
```

Keep `deploy/.env.production`, TLS private keys and secret files host-local only.

## 4. Production composition gate

Do not cut over the domain while `workstreams/ws09/DOMAIN_RELEASE_REQUESTS.json` has blocking WS03/WS07, WS13/WS07 or WS08/WS07 items.

Production requirements:

- WS03 game auth/character state uses real PostgreSQL and survives process restart.
- WS13 registration/login uses the same compatible credential/account source consumed by game login.
- WS08 uses a real persistent admin repository and server-side authorization.
- if game/auth runtime provider code changes versus C5, WS50 produces an immutable child candidate and affected contract/scenario/real-browser gates are GREEN.

C5 is never mutated in place.

## 5. Consume official-site handoff

Read:

`official-site-domain-release:coordination/handoffs/official-site-release.json`

Use its exact website source commit, artifact/digest, public account route/config, migrations and validation results. Do not rebuild/redesign the website in WS09 and do not guess the route if the handoff is absent.

## 6. Stage immutable images and static release

Replace every `REQUIRED_*_IMAGE_DIGEST` in the host-local env with an immutable image digest. Never use `latest` for cutover.

```sh
sh deploy/validate-production-env.sh deploy/.env.production
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml config --quiet
```

Stage the bundle under a durable release directory such as:

`/opt/oldkoweb/releases/oldkoweb-ws50-c5-ws10-38604174659/`

Validate WS38 `manifest.json` + `_complete`, then activate static symlinks with:

```sh
sh deploy/release-switch.sh --dry-run /opt/oldkoweb/releases/oldkoweb-ws50-c5-ws10-38604174659
sh deploy/release-switch.sh /opt/oldkoweb/releases/oldkoweb-ws50-c5-ws10-38604174659
```

## 7. Database and backups

Use the named persistent PostgreSQL volume. Apply only WS07-approved forward migrations. Before every deploy/migration:

```sh
sh deploy/backup-db.sh
```

Store an encrypted copy off-host and periodically prove restore with `deploy/restore-db.sh` in a non-production restore target. Never automatically reverse a migration over newer production writes.

## 8. Origin start

Firewall:

```text
PUBLIC: 80/tcp, 443/tcp
RESTRICTED OPERATOR: SSH/provider console
PRIVATE ONLY: 5432, 15100, 15001, 8080, Docker socket
```

Start:

```sh
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml up -d
docker compose --env-file deploy/.env.production -f docker-compose.ws09.yml ps
```

Confirm all healthchecks and inspect redacted/rotated logs. Run local/Host-header smoke before public DNS.

## 9. DNS/TLS cutover

The permanent-domain task authorizes WS09 to cut over, but only after the host is verified. Before any mutation, export the authoritative DNS zone and preserve unrelated MX/TXT/CAA/verification/nameserver records.

Apply only the records defined in `workstreams/ws09/DNS_PLAN.md`, initially TTL 300 and direct/DNS-only. Obtain/activate SAN TLS for:

```text
oldkoweb.com
play.oldkoweb.com
admin.oldkoweb.com
```

Do not enable HSTS during first cutover.

## 10. Real-domain acceptance

Run `deploy/production-smoke.sh`, then real browser acceptance. Completion requires all of:

- official homepage/assets;
- register -> login -> dashboard -> logout against real account API;
- same account recognized by KO game login;
- OYNA reaches permanent launcher;
- correct TLS hostname/chain;
- launcher/manifest/`_complete` exact release identity;
- JS/WASM/DATA MIME and `.data` `206` range;
- real WSS `/auth` and `/game`;
- real client login -> character -> Moradon -> movement;
- C5 NPC/mob visibility preserved;
- admin rejects unauthorized users and works for authorized users;
- service restart preserves account/character state and game returns healthy.

HTTP 200 or WSS 101 alone is not PASS.

## 11. Restart proof

After successful application acceptance:

1. record account + character evidence;
2. restart application services and PostgreSQL in controlled order;
3. verify the same account/character persists;
4. reconnect the browser client and repeat Moradon/movement smoke;
5. record result in `DOMAIN_DEPLOYMENT.json`.

## 12. Rollback proof

Keep the previous static release and image digests. Dry-run then prove static rollback:

```sh
sh deploy/rollback-static.sh --dry-run
```

For a live rollback, restore prior static symlinks and previous backend image digests, healthcheck, then run production smoke. DNS rollback restores only the pre-recorded apex/play/admin values while TTL remains 300. Database recovery follows WS07/WS30 and is never automatic.

## 13. Completion

Set `PERMANENT_DOMAIN_READY=true` only after real-domain browser E2E, restart persistence and rollback proof are recorded. GitHub Actions may build/test/package/deploy, but the long-running runtime must remain on the persistent host independently of Actions/chat/user PC.
