# WS44 Status

Status: COMPLETE

Branch: `ws44-server-status`

Delivered:

- public read-only realm/server status API
- stable public realm ID and display name model
- online/offline/maintenance availability state
- population categories
- privacy-safe optional aggregate online-player count, disabled by default
- public server version and target patch 1298
- heartbeat and optional uptime fields
- public status/announcement message
- minimum client content version contract
- future-compatible queue/capacity interface
- health-source adapter boundary with in-memory reference implementation
- strict public allow-list preventing IP/port/secret/DB/internal metadata leakage
- GET/HEAD-only HTTP surface
- documented short-lived public cache policy
- OpenAPI 3.1 JSON endpoint and YAML specification
- Node.js test coverage and isolated GitHub Actions workflow

No WS03 session code, WS37 ranking code, website frontend, admin, infrastructure, database migrations, client files, or main branch were modified.
