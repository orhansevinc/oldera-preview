# P2-12 integration proposal for P2-00

P2-12 deliberately does not edit the integration-owned `deploy/domain-live/**`, `deploy/local-origin/**`, release workflows, or final Compose/Nginx files. P2-00 should port the following contracts into the exact integrated release candidate.

## Runtime composition

Use one existing Compose project, not a parallel Phase-2 stack. Preserve named PostgreSQL volumes. `Update-Release.ps1` verifies the selected project and declared persistent DB mount before runtime mutation, uses `docker compose ... up -d`, and never `down`, `volume rm`, `system prune`, `git reset`, or `git clean`.

Every long-running service should have bounded logs, for example `logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }`. Do not use P2-12 retention to prune Docker volumes or images. The final release manifest must include mandatory local `health_checks`; a failed gate rolls the code composition back automatically when the migration is backward compatible, while incompatible DB rollback remains the explicit quiesced restore path.

## Nginx / P2-02 dependency

P2-02 implementation `729f9029d563f72728a7251869d2633fb1bdd5e3` now publishes the cache/fingerprint contract. Port `nginx-phase2-cache.conf` into the final edge config: `/real1298/runtime-manifest.json` is `no-store`; play shell/loading scripts revalidate; unversioned runtime files use short `must-revalidate`; only P2-02 hash-versioned `?sha256=...&bytes=...&cv=...` runtime requests may use long-lived `immutable` caching. API, auth, admin, credentials, and WebSocket routes remain `no-store`.

The final edge must keep `application/wasm`, JavaScript/JSON MIME, `.data` as `application/octet-stream`, byte ranges, `Vary: Accept-Encoding` through `gzip_vary`, COOP/COEP/CORP, WebSocket upgrade headers, 3600-second read/send timeouts, and `proxy_buffering off` for game sockets. JS/WASM compression is enabled conservatively; `.data` is deliberately excluded from blind gzip. Diagnostics checks these headers separately from login evidence. P2-13 still owns same-device cold/warm transfer/time proof.

## P2-11 migration dependency

P2-11 implementation `03445f825140997e4971c5855b32e9cd0fd631a4` publishes canonical head `0005_phase2_data_admin.sql` and requires the existing Node canonical migrator (checksum ledger + advisory lock + one-transaction-per-migration semantics). P2-00 must package that exact canonical migrator and one exact ordered migration plan with SHA-256 for every migration; P2-12 only orchestrates it and must not bypass it with direct `psql -f`. The plan must state `backup_before_migrate=true` and `rollback_compatible_with_previous_application` explicitly. The final release manifest must list the plan, runner, canonical migrator payload and migration files in `files[]` so staging is complete and checksum-verifiable.

P2-12 validates the plan before apply, takes a real PostgreSQL custom-format backup, rehearses restore in one temporary PostgreSQL container, invokes the canonical migrator through the declared Compose service, then verifies `public._oldko_migrations` checksums. Code rollback and DB restore are intentionally separate.

## Startup / laptop-host policy

`Register-Startup.ps1` reuses the exact selected Compose project/config file labels and may register one logon task. It never invents a second stack. Token-bearing cloudflared command lines are redacted and never persisted; automatic tunnel restart requires an existing Windows service or a separately reviewed config-based service/task.

`Host-Readiness.ps1` reports Docker Desktop Resource Saver, AC sleep, free disk, and container log rotation. It does not silently alter personal Docker Desktop or Windows power settings. P2-00/operator should disable sleep/Resource Saver only after reviewing those warnings for the host PC.
