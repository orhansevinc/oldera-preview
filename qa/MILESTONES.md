# OldKOWeb QA milestone contract

WS10 is an independent black-box/integration gate. A page load, successful compilation, or existence of source code is never sufficient evidence of gameplay.

| ID | PASS evidence (minimum) |
|---|---|
| M0 package integrity | `index.html`, non-empty `KnightOnLine.js/.wasm/.data`, valid WASM magic, data package >1 MiB. |
| M1 WASM runtime ready | Browser runtime marker from the real Emscripten client. |
| M2 WebGL renderer active | WebGL2 context + `render backend: OpenGL`; any Null renderer or WebGL fatal invalidates PASS. |
| M3 Login scene visible | Real login-procedure marker + screenshot whose non-black pixel ratio is >=1%. |
| M4 Auth handshake | Independent KO stub sees matching credential request and sends successful protocol response; client logs response. |
| M5 Server list | Server-list packet request/response + real client opens one-server list. |
| M6 Game connect | Browser WebSocket/TCP bridge receives a game connection and client logs target game endpoint. |
| M7 Version 1298 | `WIZ_VERSION_CHECK` round-trip proves 1298 and client expects 1298. |
| M8 Game login | Independent game stub sees matching login request and client accepts successful response. |
| M9 Nation Select | Real scene transition + non-black screenshot. |
| M10 Character Select | Nation request and `WIZ_ALLCHAR_INFO_REQ` chain + real scene transition + non-black screenshot. |
| M11 Character Create | Real Character Create transition + non-black screenshot. |
| M12 Character selectable | A create-success/list refresh/selectability marker from a real protocol-backed character; merely opening Character Create is FAIL. |
| M13 Zone transition | Character-to-world/game zone transition evidence after M12. |
| M14 Moradon terrain render | Moradon/zone 21 terrain-load evidence plus active non-Null renderer; static background is not accepted. |
| M15 Player spawn | Local player spawn evidence in the world. |
| M16 movement/input | Input causes observable player/world position state change; keypress alone is not accepted. |
| M17 Admin API health | `/api/admin/health` (base configurable) returns HTTP 2xx and explicit ready/ok/healthy state. |
| M18 Admin player lookup | `/players?q=osevinc` (fixture configurable) returns HTTP 2xx and contains the requested player. |
| M19 ban/unban API | Reversible POST `/sanctions` + DELETE `/sanctions/:character` both succeed. |
| M20 persistence restart test | A QA sanction is created, configured service restart is executed, sanction is still queryable after recovery, then cleaned up. |

## Fatal rules

`pageerror`, `GL_INVALID_ENUM`, `GL_INVALID_VALUE`, `GL_INVALID_OPERATION`, repeated WebGL invalid errors, or `render backend: Null` invalidate renderer-dependent milestones. Timeouts are FAIL, never SKIP/PASS. Missing service URLs/commands are FAIL because WS10 does not infer readiness.

## Artifacts

Every run keeps `milestones.json`, `summary.md`, browser console log, screenshots, network metadata, protocol fixture state, and harness errors when present. GitHub Actions retention is 14 days.

## Ref integration

`.github/workflows/ws10-e2e.yml` accepts `client_ref`, `gateway_ref`, `session_ref`, `database_ref`, `admin_ref`, `admin_base_url`, and optional `restart_command`. Refs are fetched/read independently; WS10 never merges them into its branch. Today the client package is staged from `client_ref:openko-web`.
