import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryRateLimitStore,
  createKeyBuilder,
  createProtectionMiddleware,
  createRateLimiter,
  exactTrustedProxies,
  resolveClientIp,
  toRateLimitHeaders
} from "../../packages/oldko-abuse-protection/src/index.js";

const fixed = { name: "fixed", algorithm: "fixed-window", limit: 2, windowMs: 1000, failMode: "closed" };
const sliding = { name: "sliding", algorithm: "sliding-window", limit: 2, windowMs: 1000, failMode: "closed" };
const token = { name: "token", algorithm: "token-bucket", limit: 2, capacity: 2, refillPerSecond: 1, failMode: "closed" };

test("opaque key builder never embeds raw identifiers", () => {
  const keys = createKeyBuilder({ hmacSecret: "test-secret" });
  const ip = keys.ip("203.0.113.10");
  const account = keys.account("account-123");
  const bucket = keys.compose({ policy: "login", action: "auth.login", keys: [ip, account] });
  assert.match(ip, /^ip:/);
  assert.ok(!bucket.includes("203.0.113.10"));
  assert.ok(!bucket.includes("account-123"));
});

test("client IP ignores spoofed forwarded header from untrusted peer", () => {
  const result = resolveClientIp(
    { remoteAddress: "198.51.100.7", headers: { "x-forwarded-for": "203.0.113.99" } },
    { trustProxy: exactTrustedProxies(["10.0.0.2"]) }
  );
  assert.equal(result.ip, "198.51.100.7");
  assert.equal(result.forwardedAccepted, false);
});

test("client IP accepts forwarded chain only behind explicitly trusted proxies", () => {
  const trustProxy = exactTrustedProxies(["10.0.0.2", "10.0.0.3"]);
  const result = resolveClientIp(
    { remoteAddress: "10.0.0.2", headers: { "x-forwarded-for": "203.0.113.44, 10.0.0.3" } },
    { trustProxy }
  );
  assert.equal(result.ip, "203.0.113.44");
  assert.equal(result.forwardedAccepted, true);
  assert.equal(result.hopCount, 2);
});

test("fixed-window denies after the configured limit and recovers in next window", async () => {
  let now = 100;
  const store = new InMemoryRateLimitStore({ now: () => now });
  const limiter = createRateLimiter({ store, policies: { fixed }, now: () => now });
  assert.equal((await limiter.check({ policy: "fixed", action: "x", bucketKey: "k" })).allowed, true);
  assert.equal((await limiter.check({ policy: "fixed", action: "x", bucketKey: "k" })).allowed, true);
  const denied = await limiter.check({ policy: "fixed", action: "x", bucketKey: "k" });
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterSeconds, 1);
  now = 1100;
  assert.equal((await limiter.check({ policy: "fixed", action: "x", bucketKey: "k" })).allowed, true);
});

test("sliding-window handles expiry without fixed-window boundary bursts", async () => {
  let now = 0;
  const store = new InMemoryRateLimitStore({ now: () => now });
  const limiter = createRateLimiter({ store, policies: { sliding }, now: () => now });
  await limiter.check({ policy: "sliding", action: "x", bucketKey: "k" });
  now = 900;
  await limiter.check({ policy: "sliding", action: "x", bucketKey: "k" });
  now = 950;
  assert.equal((await limiter.check({ policy: "sliding", action: "x", bucketKey: "k" })).allowed, false);
  now = 1001;
  assert.equal((await limiter.check({ policy: "sliding", action: "x", bucketKey: "k" })).allowed, true);
});

test("token-bucket refills over time", async () => {
  let now = 0;
  const store = new InMemoryRateLimitStore({ now: () => now });
  const limiter = createRateLimiter({ store, policies: { token }, now: () => now });
  assert.equal((await limiter.check({ policy: "token", action: "x", bucketKey: "k" })).allowed, true);
  assert.equal((await limiter.check({ policy: "token", action: "x", bucketKey: "k" })).allowed, true);
  assert.equal((await limiter.check({ policy: "token", action: "x", bucketKey: "k" })).allowed, false);
  now = 1000;
  assert.equal((await limiter.check({ policy: "token", action: "x", bucketKey: "k" })).allowed, true);
});

test("fail-open and fail-closed are explicit on store errors", async () => {
  const brokenStore = { async consume() { throw new Error("down"); } };
  const policies = {
    open: { name: "open", algorithm: "fixed-window", limit: 1, windowMs: 1000, failMode: "open" },
    closed: { name: "closed", algorithm: "fixed-window", limit: 1, windowMs: 1000, failMode: "closed" }
  };
  const limiter = createRateLimiter({ store: brokenStore, policies });
  const open = await limiter.check({ policy: "open", action: "read", bucketKey: "a" });
  const closed = await limiter.check({ policy: "closed", action: "write", bucketKey: "b" });
  assert.equal(open.reason, "store_error_fail_open");
  assert.equal(open.allowed, true);
  assert.equal(closed.reason, "store_error_fail_closed");
  assert.equal(closed.allowed, false);
});

test("trusted internal traffic gets a separate enlarged bucket instead of implicit bypass", async () => {
  const policy = {
    name: "cmd",
    algorithm: "fixed-window",
    limit: 1,
    windowMs: 1000,
    failMode: "closed",
    trustedInternal: { mode: "separate", multiplier: 2 }
  };
  const store = new InMemoryRateLimitStore({ now: () => 0 });
  const limiter = createRateLimiter({ store, policies: { cmd: policy }, now: () => 0 });
  assert.equal((await limiter.check({ policy: "cmd", action: "command", bucketKey: "same" })).allowed, true);
  assert.equal((await limiter.check({ policy: "cmd", action: "command", bucketKey: "same" })).allowed, false);
  assert.equal((await limiter.check({ policy: "cmd", action: "command", bucketKey: "same", trustedInternalService: "jobs" })).allowed, true);
  assert.equal((await limiter.check({ policy: "cmd", action: "command", bucketKey: "same", trustedInternalService: "jobs" })).allowed, true);
});

test("observer receives fingerprints, not bucket keys", async () => {
  const events = [];
  const store = new InMemoryRateLimitStore({ now: () => 0 });
  const limiter = createRateLimiter({ store, policies: { fixed }, now: () => 0, observer: (event) => events.push(event) });
  await limiter.check({ policy: "fixed", action: "x", bucketKey: "raw-sensitive-bucket" });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "decision");
  assert.ok(events[0].keyFingerprint);
  assert.equal(JSON.stringify(events[0]).includes("raw-sensitive-bucket"), false);
});

test("middleware returns standard 429 response and Retry-After", async () => {
  const store = new InMemoryRateLimitStore({ now: () => 0 });
  const policy = { name: "one", algorithm: "fixed-window", limit: 1, windowMs: 1000, failMode: "closed" };
  const limiter = createRateLimiter({ store, policies: { one: policy }, now: () => 0 });
  const middleware = createProtectionMiddleware({
    limiter,
    policy: "one",
    action: "route",
    identify: () => ({ bucketKey: "k" })
  });
  assert.equal(await middleware({}, async () => "ok"), "ok");
  const denied = await middleware({}, async () => "should-not-run");
  assert.equal(denied.status, 429);
  assert.equal(denied.headers["Retry-After"], "1");
  assert.equal(toRateLimitHeaders({ ...denied, allowed: false }).constructor, Object);
});
