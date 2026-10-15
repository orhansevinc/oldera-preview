# OldKOWeb domain-live diagnostics

WS29 owns observability contracts and diagnostic tooling only. It does not modify provider product logic or WS03/WS05/WS07/WS08/WS09/WS10/WS13 branches.

## One-shot incident bundle

From the repository root with Node 20+:

```text
node packages/oldko-observability/bin/oldko-diagnostics.js incident bundle --config observability/domain-live.example.json --out diagnostics
```

The command creates an `oldkoweb-incident-<timestamp>/` directory containing `summary.json`, `release.json`, `health.json`, `migrations.json`, `containers.json`, `known-error-signatures.json`, `browser-evidence.json`, and sanitized `logs/*.log` files. It deliberately does not collect database dumps, passwords, cookies, private keys, raw tokens, or Docker environment variables.

A health-only run is also available:

```text
node packages/oldko-observability/bin/oldko-diagnostics.js health collect --config observability/domain-live.example.json
```

## Release identity

`release.handoff_file` may point at an exact WS50 domain-live handoff. The reader accepts `release_id`, exact `source_commit`, `provider_set` (or the handoff's pinned parent provider set when no final set exists yet), client artifact/digest/build, service versions, and migration head. A moving branch name or branch HEAD is never emitted as a version.

## Correlation contract

Safe diagnostic fields are `request_id`, `trace_id`, `session_ref`, `account_hash`, `character_id`, `game_connection_id`, `runtime_target_id`, and `admin_command_id`. Raw account identifiers are not required: `account_hash` is SHA-256 scoped by release identity. Passwords, auth tokens and cookies are never correlation fields.

The canonical flow stage chains are:

- account-to-game: `website -> account_api -> postgresql -> game_auth -> game_session -> character -> world_ready`
- combat: `mob_visibility -> target -> attack -> slash -> hp -> death`
- admin command: `admin_login -> command_enqueue -> downstream -> terminal_status`

## Collector input

The reusable collector accepts a Docker compose project/file, optional service allowlist, HTTP health/readiness endpoints, an optional PostgreSQL service name for `pg_isready`, migration metadata/file, a disk path, and bounded log tail settings. Container state, restart count, Docker health, gateway ports and sanitized recent logs are allowlisted. Full `docker inspect` output and container environment variables are not retained.

## Browser evidence handoff

WS10/WS05 may provide references only; WS29 does not create screenshots. The generic evidence record supports `run_id`, `provider_set`, `entity_runtime_id`, `asset_id`, `frame_evidence_path`, plus optional booleans such as `entity_created`, `model_loaded`, `asset_missing`, and `websocket_disconnected` for evidence-backed classification.

## Secret redaction

Recursive key redaction and string sanitization cover password variants, Authorization/Proxy-Authorization, Cookie/Set-Cookie, CSRF/XSRF, verification tokens, password-reset tokens, delivery webhook secrets, DATABASE_URL/DB URL credentials, tunnel tokens, admin session secrets, private keys, query parameters, assignment strings and Bearer values. Binary payloads are never rendered. The bundle writer can run an exact-byte forbidden-value scan and abort/delete the bundle on any match; CI uses this for synthetic leakage tests.

## Failure classification

Known categories are `ACCOUNT_API_UNREADY`, `DATABASE_UNREACHABLE`, `MIGRATION_MISMATCH`, `AUTH_GATEWAY_DOWN`, `GAME_GATEWAY_DOWN`, `WORLD_NOT_READY`, `WEBSOCKET_DISCONNECT`, `CLIENT_ASSET_MISSING`, `ENTITY_NOT_CREATED`, `MODEL_LOAD_FAILED`, `ADMIN_REPOSITORY_UNREADY`, and `ADMIN_RUNTIME_BRIDGE_UNREADY`. Categories require health/system/log/browser evidence. With no supported evidence the result is `UNKNOWN`; the tool does not guess a root cause.

## Windows PowerShell

The CLI has no shell-specific syntax. Example from `C:\Users\Orhan\OldKOWeb`:

```powershell
node .\packages\oldko-observability\bin\oldko-diagnostics.js incident bundle --config .\observability\domain-live.example.json --out .\diagnostics
```

A future WS09 `diagnose-oldkoweb.ps1` wrapper can call this exact command and pass a generated config path. WS29 does not change WS09 scripts.

## Retention

Bundle collection is bounded by Docker `--since`, `--tail`, and per-service text truncation. The default incident-directory retention is at most 10 bundles and 7 days, configurable in the input. WS29 does not override deployment Docker logging configuration; it is compatible with an existing WS09 rotation policy. If a deployment has no rotation contract, use Docker's normal `json-file`/`local` rotation controls (for example a finite max size and file count) in the infrastructure owner rather than in WS29.
