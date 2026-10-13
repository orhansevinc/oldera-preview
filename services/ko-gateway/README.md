# OldKOWeb KO Gateway (WS02)

Packet-agnostic WebSocket <-> TCP transport for the real OldKO 1298 browser client. It does not parse, create, inspect, or mutate KO packets.

## Run locally

Auth instance:

```bash
GATEWAY_MODE=auth \
AUTH_TCP_HOST=127.0.0.1 AUTH_TCP_PORT=15100 \
ALLOWED_ORIGINS=http://localhost:8000 \
ALLOWED_HOSTS=localhost:8080 \
PORT=8080 node services/ko-gateway/src/server.js
```

Game instance (same image/code, different environment):

```bash
GATEWAY_MODE=game \
GAME_TCP_HOST=127.0.0.1 GAME_TCP_PORT=15001 \
ALLOWED_ORIGINS=https://play.oldkoweb.com \
ALLOWED_HOSTS=gateway.oldkoweb.com \
PORT=8080 node services/ko-gateway/src/server.js
```

The defaults are `/auth` or `/game` for WebSocket path and `/healthz` for health. `WS_PATH` can override the WebSocket path. Domain names are examples only; DNS is not assumed to exist.

## Environment

- `GATEWAY_MODE=auth|game`
- `AUTH_TCP_HOST`, `AUTH_TCP_PORT` / `GAME_TCP_HOST`, `GAME_TCP_PORT`
- fallback: `TCP_TARGET_HOST`, `TCP_TARGET_PORT`
- `LISTEN_HOST` (default `0.0.0.0`), `PORT` (default `8080`)
- `WS_PATH`, `HEALTH_PATH`
- `ALLOWED_ORIGINS` comma-separated exact origins; empty means allow any origin when present
- `ALLOWED_HOSTS` comma-separated exact HTTP Host / X-Forwarded-Host values
- `REQUIRE_ORIGIN` default `true`
- `TRUST_PROXY` default `true` (uses `X-Forwarded-Host` for host checks)
- `TCP_CONNECT_TIMEOUT_MS` default `5000`
- `IDLE_TIMEOUT_MS` default `120000`
- `PING_INTERVAL_MS` default `30000`
- `PONG_TIMEOUT_MS` default `10000`
- `MAX_MESSAGE_BYTES` default 8 MiB
- `MAX_BUFFERED_BYTES` default 16 MiB
- `LOG_LEVEL=error|warn|info|debug`

TLS is intentionally terminated by a reverse proxy/load balancer. The application speaks HTTP/WebSocket behind that proxy and stores no TLS private keys or other secrets in the repository.

## Docker

From repository root:

```bash
docker build -f services/ko-gateway/Dockerfile -t oldkoweb-ko-gateway .
docker run --rm -p 8080:8080 \
  -e GATEWAY_MODE=auth \
  -e AUTH_TCP_HOST=host.docker.internal \
  -e AUTH_TCP_PORT=15100 \
  -e ALLOWED_ORIGINS=http://localhost:8000 \
  -e ALLOWED_HOSTS=localhost:8080 \
  oldkoweb-ko-gateway
```

## Security/logging properties

The gateway logs connection lifecycle, mode, target address, and generic error codes only. It never logs packet bytes, account credentials, WebSocket payloads, or KO protocol fields. Origin and Host allowlists are deployment configuration, not hard-coded secrets.
