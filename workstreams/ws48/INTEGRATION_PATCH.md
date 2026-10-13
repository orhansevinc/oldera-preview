# WS48 Integration Patch

WS48 deliberately changes no consuming service. Integration is opt-in per service.

## Package import

```js
import {
  InMemoryRateLimitStore,
  createKeyBuilder,
  createRateLimiter,
  createProtectionMiddleware,
  resolveClientIp
} from "../../packages/oldko-abuse-protection/src/index.js";
import { DEFAULT_ABUSE_POLICIES } from "../../abuse-protection/default-policies.js";
```

Production must replace `InMemoryRateLimitStore` with an atomic distributed adapter implementing `consume(request)`.

## HTTP integration sequence

1. Resolve socket peer and client IP with `resolveClientIp`; configure `trustProxy` from deployment-owned proxy addresses/CIDRs.
2. Authenticate account/internal service normally.
3. HMAC client IP/account/actor using `createKeyBuilder` and compose a bucket from policy + stable action + applicable keys.
4. Call limiter/middleware before expensive work.
5. Return HTTP 429 with `toRateLimitHeaders(result)` on `rate_limited` / fail-closed denial.
6. Emit observer events to service telemetry. Do not log raw bucket keys or raw IP by default.

## Suggested service mapping

- Account login → `login-attempts`, IP + account if known.
- Registration → `registration`, IP plus optional device/actor key if independently available.
- Password reset → `password-reset`, IP + normalized account/email-derived account key after privacy review.
- Admin mutations → `admin-mutation`, admin actor + action; keep authorization separate.
- Public ranking/search → `public-search-ranking`, IP + route/query-cost.
- WebSocket handshake → `websocket-connect`, IP + account when authenticated.
- Malformed request rejection path → `malformed-request-storm`, IP + parser/route class.
- Command bus → `command-bus-calls`, authenticated service/actor + command name and cost.

## Required external decisions

- choose/store `OLDKO_ABUSE_KEY_HMAC_SECRET` (or equivalent secret-managed name);
- provide Redis/equivalent atomic distributed store for multi-instance production;
- supply trusted proxy CIDR/address matcher from infrastructure topology;
- tune policy values using telemetry without weakening fail-closed security-sensitive paths.

No DB migration is required.
