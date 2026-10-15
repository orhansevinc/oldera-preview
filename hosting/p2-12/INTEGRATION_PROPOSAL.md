# P2-12 integration proposal for P2-00

P2-12 deliberately does not edit the integration-owned `deploy/domain-live/**`, `deploy/local-origin/**`, release workflows, or final Compose/Nginx files. P2-00 should port the following contracts into the exact integrated release candidate.

## Runtime composition

Use one existing Compose project, not a parallel Phase-2 stack. Preserve named PostgreSQL volumes. `Update-Release.ps1` uses `docker compose ... up -d` and never `down`, `volume rm`, `system prune`, `git reset`, or `git clean`.

Every long-running service should have bounded logs, for example `logging: { driver: json-file, options: { max-size: "20m", max-file: "5" } }`. Do not use P2-12 retention to prune Docker volumes or images.

## Nginx / P2-02 dependency

Port `nginx-phase2-cache.conf` into the final edge config after P2-02 publishes its cache/fingerprint contract. Until content-addressed or release-versioned asset URLs are guaranteed, P2-12 intentionally uses short `must-revalidate` caching for `.wasm/.data/.js` instead of a year-long `immutable` policy. HTML, API, auth, admin, and WebSocket routes are `no-store`.

The final edge must keep `application/wasm`, byte ranges, COOP/COEP/CORP, WebSocket upgrade headers, 3600-second read/send timeouts, and `proxy_buffering off` for game sockets. Diagnostics checks these headers separately from login evidence.

## P2-11 migration dependency

P2-11 should publish one exact ordered migration plan with SHA-256 for every migration and a PowerShell 5.1-compatible runner path inside the release package. The plan must state `backup_before_migrate=true` and `rollback_compatible_with_previous_application` explicitly. The final release manifest must list the plan, runner, and migration payload files in `files[]` so staging is complete and checksum-verifiable. P2-12 validates the plan before any apply, takes a real PostgreSQL custom-format backup, and rehearses restore in one temporary PostgreSQL container.

Code rollback and DB restore are intentionally separate. If the migration plan is not backward compatible with the previous application, `Rollback-Code.ps1` refuses to switch code until the operator chooses the matching DB restore path.

## Startup / laptop-host policy

`Register-Startup.ps1` reuses the exact selected Compose project/config file labels and may register one logon task. It never invents a second stack. Token-bearing cloudflared command lines are redacted and never persisted; automatic tunnel restart requires an existing Windows service or a separately reviewed config-based service/task.

`Host-Readiness.ps1` reports Docker Desktop Resource Saver, AC sleep, free disk, and container log rotation. It does not silently alter personal Docker Desktop or Windows power settings. P2-00/operator should disable sleep/Resource Saver only after reviewing those warnings for the host PC.
