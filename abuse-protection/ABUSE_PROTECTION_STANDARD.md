# OldKOWeb Abuse Protection Standard

## Scope

This standard defines a common server-side rate-limit and abuse-protection contract for HTTP APIs, WebSocket connection attempts and command-bus entry points. It is intentionally transport-neutral and does not modify any consuming service.

## Decision model

Every protected operation resolves:

1. **policy** — named rule such as `login-attempts`;
2. **action** — stable route/command action such as `auth.login` or `ranking.search`;
3. **actor key material** — one or more opaque IP/account/actor/service components;
4. **cost** — default `1`, higher for expensive operations;
5. **trusted internal service identity** — only after independent service authentication.

The limiter returns a uniform allow/deny decision with `remaining`, `resetAt`, `retryAfterMs` and `retryAfterSeconds`. HTTP adapters should emit `Retry-After` on denial plus RateLimit headers where applicable.

## Key contract and privacy

Raw client IPs, account IDs and actor IDs must not be embedded directly in shared bucket keys or routine logs. `createKeyBuilder()` HMACs each identifier with an environment secret and domain-separated labels. Observability receives only a short SHA-256 bucket fingerprint.

The HMAC secret is configuration/secrets material and must not be committed. Rotating it resets effective rate-limit identity, so rotations should be operationally planned.

Log raw IP only when a separate security/incident policy explicitly requires it. Prefer HMAC pseudonymization for correlation or redact to a coarse network prefix at the logging boundary.

## Client IP and trusted proxies

Never trust `X-Forwarded-For` merely because it is present. The direct socket peer must first match the configured trusted-proxy predicate. The resolver then walks the forwarded chain from the socket backwards and stops at the first untrusted hop.

Production deployments should build the predicate from the exact reverse-proxy/load-balancer addresses or an infrastructure-owned CIDR adapter. Do not use `trust all`, arbitrary hop counts, or user-controlled headers as proof of client identity.

## Algorithms

- **fixed-window** — low-cost counters for coarse storm protection;
- **sliding-window** — better boundary behavior for login/reset/WebSocket attempts;
- **token-bucket** — burst allowance with sustained-rate control for reads, mutations and command-bus traffic.

`DistributedRateLimitStore.consume()` is the cross-service adapter contract. A production adapter must make consume atomic for a bucket (for example with Redis/Lua or an equivalent transactional primitive). `InMemoryRateLimitStore` is for tests, local development and single-process diagnostics only.

## Fail-open / fail-closed

Fail mode is explicit per policy:

- **closed** for authentication, registration, password reset, admin mutations, WebSocket connects, malformed-request storms and command-bus mutations; a store failure denies with a short retry window;
- **open** only where availability outweighs abuse risk, such as public read-only search/ranking. Store failures are still emitted through observability hooks.

A consuming service must not silently override the declared fail mode.

## Trusted internal services

Internal traffic is not trusted by network location alone. A service identity must come from an independent authenticated mechanism (mTLS identity, signed service token, workload identity, etc.). Policies choose one of:

- `same` — internal traffic uses normal limits;
- `separate` — recommended default; authenticated service traffic receives a separate bucket and optional multiplier;
- `bypass` — exceptional and must be security-reviewed because it removes limiter enforcement.

The package never authenticates an internal service by itself; it accepts only the already-verified identity string.

## Observability

Observers receive decisions and store errors without raw IP/account data. Recommended counters: policy, action, allowed/denied, reason, store-error class and trusted/internal mode. Do not use raw bucket keys as metric labels because cardinality is unbounded.

## Recommended baseline policies

`abuse-protection/default-policies.js` provides conservative starting values for login, registration, password reset, admin mutation, public ranking/search, WebSocket connect, malformed-request storms and command-bus calls. These are defaults, not historical 1298 game mechanics, and must be tuned from service telemetry.

## Layering

Abuse protection supplements but does not replace authentication, authorization, CSRF protection, request/body size limits, schema validation, queue backpressure, circuit breakers or upstream DDoS controls.
