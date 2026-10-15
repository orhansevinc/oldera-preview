# OldKOWeb Windows local persistent origin

This directory is a **thin local wrapper** over `docker-compose.ws09.yml`. It does not create a second production topology. It keeps the WS09 service names, backend network, `oldkoweb_postgres_data` named volume, health ordering, bounded Docker log rotation and `restart: unless-stopped` behavior.

## What this is / is not

- Target: Windows 11 Pro + WSL2 + Docker Desktop + Git.
- Local edge: HTTP only on `127.0.0.1:8088` by default.
- Public DNS: untouched.
- Production TLS: not claimed and not generated here.
- Cloudflare credentials, DNS credentials and production mail credentials: never requested or stored by these scripts.
- The currently pinned WS09 candidate is allowed only as a **local test fixture**. It contains the historical C5 gameplay image and no accepted production WS08 image. `bootstrap.ps1` therefore defaults to `fixture` admin mode and explicitly does not claim gameplay or production acceptance.

## Morning path: one command

From PowerShell in `C:\Users\Orhan\OldKOWeb`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy\local-origin\bootstrap.ps1
```

The default command downloads the exact known candidate asset, verifies the pinned SHA256 **before extraction**, validates every file against the bundle's internal `SHA256SUMS`, loads the bundle images, creates local-only random secrets, takes a pre-migration backup, applies the pinned migration plan, starts the existing WS09 Compose topology through the local overlay, waits for health and runs smoke checks.

If the GitHub release asset has been replaced, the pinned SHA256 fails closed. It will not silently consume a newer bundle.

To use a future immutable release, either pass an immutable bundle + checksum or copy `release-manifest.example.json` to an untracked local file and pass `-ManifestPath`. Example bundle form:

```powershell
.\deploy\local-origin\update-release.ps1 `
  -BundlePath C:\path\to\oldkoweb-release.tar.gz `
  -ChecksumPath C:\path\to\oldkoweb-release.tar.gz.sha256 `
  -MigrationPlanPath C:\path\to\that-release-migration-plan.json `
  -Mode release
```

Equivalent manifest form:

```powershell
.\deploy\local-origin\update-release.ps1 -ManifestPath C:\path\release-input.json
```

The input manifest accepts `release_id`, `bundle_path` (or `bundle_url`), `bundle_sha256`, `migration_plan`, and `mode`; it contains no credentials. A future `release` bundle must include a real immutable `admin-api.tag` receipt. Otherwise `Mode=release` fails. The current candidate remains `fixture` only.

## Daily commands

```powershell
.\deploy\local-origin\up.ps1
.\deploy\local-origin\status.ps1
.\deploy\local-origin\doctor.ps1
.\deploy\local-origin\smoke.ps1
.\deploy\local-origin\logs.ps1 -Service account-api -Follow
.\deploy\local-origin\stop.ps1
```

`stop.ps1` stops containers only. It does not delete the named PostgreSQL volume, release cache, backups or generated local secret files. Docker services use the production `restart: unless-stopped` policy, so after a PC restart they can return when Docker Desktop/engine starts. Whether Docker Desktop itself starts at Windows sign-in remains a local Docker Desktop setting.

## Local routing without HOSTS edits

No script edits the Windows HOSTS file. Smoke uses host resolution only for the command invocation, equivalent to:

```powershell
curl.exe --resolve oldkoweb.com:8088:127.0.0.1 http://oldkoweb.com:8088/
curl.exe --resolve oldkoweb.com:8088:127.0.0.1 http://oldkoweb.com:8088/__local/account-health
curl.exe --resolve play.oldkoweb.com:8088:127.0.0.1 http://play.oldkoweb.com:8088/__local/auth-health
curl.exe --resolve play.oldkoweb.com:8088:127.0.0.1 http://play.oldkoweb.com:8088/__local/game-health
curl.exe --resolve admin.oldkoweb.com:8088:127.0.0.1 http://admin.oldkoweb.com:8088/__local/admin-health
```

This tests Nginx host routing and upstream health without changing public DNS. HTTP local mode is not a substitute for browser acceptance of secure cookies, WSS or production TLS; those remain later edge/WS10 work.

## Persistence

- PostgreSQL data: Docker named volume `oldkoweb_postgres_data`.
- Application/account/admin/game state: persists only to the extent that the selected release images use the shared PostgreSQL persistence contracts. The current historical C5 session-world image is explicitly **not** accepted as the final persistent gameplay child.
- Release/client files: checksum-addressed `.state/cache` + immutable extracted `.state/releases` directories.
- Logs: existing WS09 Docker `json-file` rotation (`20m`, 5 files).
- Generated local secrets: `.state/secrets`, gitignored. They are local application secrets only.

## Migrations and backup

`migration-plan.domain-live-20261015.json` is pinned to the current WS07/WS13 owner handoffs at task start. It does not inspect a moving branch head. The plan is:

1. WS07 `0001_init.sql`
2. WS07 `0002_persistence_hardening.sql`
3. WS07 `0003_public_account_api.sql`
4. WS07 `0004_admin_persistence.sql`
5. WS13 service-owned `0001_postgres_rate_limit.sql`

Every WS07 SQL file is downloaded from an exact source commit and SHA256 verified before it is mounted into the already verified account image's migration runner. The WS13 migration is SHA256 checked inside that image before execution. A logical gzip PostgreSQL backup is always created and copied to `.state/backups` before migrations.

Migrations are forward-only. Rollback never blindly restores an older database schema. `rollback.ps1` switches the application/static release back while retaining the current database schema; if the old application cannot run against the forward schema, it fails visibly instead of destroying data.

## Secrets

The repository contains placeholders only. `bootstrap.ps1` creates cryptographically random local PostgreSQL and admin session secrets on first run. The following stay `NOT_CONFIGURED` in this task:

- production mail webhook/provider credential
- Cloudflare token / account ID / zone ID / tunnel credential
- authoritative DNS credential
- real production admin principals/config until supplied by the owning release

`doctor.ps1` prints state, never secret values.

## Future cloudflared handoff

`cloudflared.example.yml` is a credential-free mapping contract for:

- `oldkoweb.com` -> `http://127.0.0.1:8088`
- `play.oldkoweb.com` -> `http://127.0.0.1:8088`
- `admin.oldkoweb.com` -> `http://127.0.0.1:8088`

Do not put a real tunnel token, tunnel credentials JSON, account ID or zone ID in the repository. This task does not create a tunnel and does not change DNS.
