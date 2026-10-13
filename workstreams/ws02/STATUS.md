# WS02 Status — WebSocket ↔ TCP Gateway

## Scope

Implemented only in the WS02-owned paths. No WASM/client, admin, website, database, KO game logic, or shared workflow files were changed.

## Delivered

- Packet-agnostic WebSocket server with RFC6455 binary frame handling.
- Transparent binary byte forwarding to/from a configured TCP target.
- Single service image supports `GATEWAY_MODE=auth` and `GATEWAY_MODE=game` instances.
- TCP connect timeout and upstream-unavailable rejection.
- WebSocket ping/pong liveness and idle timeout.
- Origin and Host allowlists, with reverse-proxy `X-Forwarded-Host` support.
- Backpressure in both directions via stream pause/resume plus configurable buffered-byte guard.
- Clean disconnect propagation and reconnect support.
- `/healthz` endpoint that does not reveal packet data or target credentials.
- Structured lifecycle logging with no payload/credential logging.
- Dockerfile with non-root runtime user.
- Dedicated WS02 GitHub Actions workflow.

## Tests

`node --test tests/ko-gateway/*.test.js`

Covers:

1. local echo/mock TCP server,
2. binary roundtrip,
3. 1 MiB large packet,
4. disconnect/reconnect,
5. 12 concurrent isolated connections,
6. TCP target unavailable,
7. origin rejection,
8. health endpoint.

## Production integration

TLS should terminate at a reverse proxy/load balancer. Run separate auth/game containers (or processes) from the same image with different environment variables and paths. No repository secrets are required or embedded.
