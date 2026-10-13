# WS20 Bug Register

## HIGH — WS20-SEC-001 — Predictable admin session signing fallback

**Affected WS:** WS08 (admin API parity/hardening), WS09 (production configuration)

**Reproduce**
1. Inspect `server/src/index.js`.
2. Locate the `cookieSession` configuration.
3. Observe `keys: [process.env.SESSION_SECRET || 'dev-only-change-me']`.
4. Start a deployment without `SESSION_SECRET` and note that the server still boots with the publicly known fallback signing key.

**Expected**
A privileged admin API must fail closed when a strong session-signing secret is absent in any deployable environment. There must be no predictable signing-key fallback capable of authenticating owner session cookies.

**Actual**
The server uses the fixed string `dev-only-change-me` whenever `SESSION_SECRET` is missing. Because authorization trusts `req.session.authority === 'ROOT_OWNER'`, compromise of the signing key can undermine the admin authentication boundary.

**Evidence**
- `server/src/index.js`: cookie-session key fallback is a literal known string.
- `security-tests/static-source-audit.mjs`: `WS20-SEC-001` detects this pattern and returns a blocking failure.

---

## MEDIUM — WS20-REL-001 — No explicit graceful shutdown handling

**Affected WS:** WS08 (admin API lifecycle), WS09 (deployment/restart behavior)

**Reproduce**
1. Inspect `server/src/index.js` for `SIGTERM` / `SIGINT` handlers.
2. Run `node reliability/service-lifecycle-probe.mjs` after installing `server/` dependencies.
3. The probe starts the service, sends SIGTERM, records the exit mode, then starts it again.

**Expected**
The service should stop accepting new requests, close the HTTP listener, close reusable external resources, and exit cleanly with code 0 within the shutdown deadline.

**Actual**
No explicit SIGTERM/SIGINT lifecycle handler is present. The baseline process exits by signal rather than through a controlled graceful-shutdown path.

**Evidence**
- `security-tests/static-source-audit.mjs`: `WS20-REL-001`.
- `reliability/service-lifecycle-probe.mjs`: expects clean exit and separately verifies restart recovery.

---

## MEDIUM — WS20-SEC-002 — IP rate-limit trust depends on exact proxy topology

**Affected WS:** WS08 (admin API), WS09 (reverse-proxy deployment)

**Reproduce**
1. Inspect `server/src/index.js`.
2. Observe `app.set('trust proxy', 1)` while login/API limiters depend on Express client IP semantics.
3. Deploy the app in a topology where clients can reach the Node service directly or where the number of trusted proxy hops differs from exactly one.
4. Supply forged forwarding headers and compare the IP identity used for rate-limit bucketing.

**Expected**
Client IP used for security rate limits must be derived only from explicitly trusted proxy addresses/topology, and direct access to the application port must not let a client control the effective IP.

**Actual**
The application uses numeric hop trust (`1`). This is safe only under a strictly enforced matching topology; otherwise rate-limit identity may be spoofable or inconsistent.

**Evidence**
- `server/src/index.js`: `app.set('trust proxy', 1)`.
- `security-tests/static-source-audit.mjs`: `WS20-SEC-002` reports the topology-dependent configuration.

## Open integration coverage (not bugs yet)

The following required scenarios cannot be classified as product pass/fail from `main` because their target services are not present yet: WS02 concurrent WebSocket/reconnect/backpressure/dead-TCP, WS03 malformed/oversized KO packets, WS13 stale-session/duplicate-login, and WS09 container recovery. They remain explicitly BLOCKED in `reliability/TEST_PLAN.md`; a skip is not counted as PASS.
