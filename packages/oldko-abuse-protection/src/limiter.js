import { fingerprintBucketKey } from "./keys.js";

const ALGORITHMS = new Set(["fixed-window", "sliding-window", "token-bucket"]);
const FAIL_MODES = new Set(["open", "closed"]);
const INTERNAL_MODES = new Set(["same", "separate", "bypass"]);

export function validatePolicy(policy) {
  if (!policy || typeof policy !== "object") throw new TypeError("policy is required");
  if (typeof policy.name !== "string" || !policy.name) throw new TypeError("policy.name is required");
  if (!ALGORITHMS.has(policy.algorithm)) throw new TypeError(`invalid algorithm for ${policy.name}`);
  if (!FAIL_MODES.has(policy.failMode)) throw new TypeError(`invalid failMode for ${policy.name}`);
  if (!Number.isFinite(policy.limit) || policy.limit <= 0) throw new TypeError(`limit must be > 0 for ${policy.name}`);
  if (policy.algorithm !== "token-bucket" && (!Number.isFinite(policy.windowMs) || policy.windowMs <= 0)) {
    throw new TypeError(`windowMs must be > 0 for ${policy.name}`);
  }
  if (policy.algorithm === "token-bucket" && (!Number.isFinite(policy.refillPerSecond) || policy.refillPerSecond <= 0)) {
    throw new TypeError(`refillPerSecond must be > 0 for ${policy.name}`);
  }
  const mode = policy.trustedInternal?.mode ?? "separate";
  if (!INTERNAL_MODES.has(mode)) throw new TypeError(`invalid trustedInternal.mode for ${policy.name}`);
  return Object.freeze({ ...policy, trustedInternal: Object.freeze({ mode, multiplier: policy.trustedInternal?.multiplier ?? 4 }) });
}

function scaledPolicy(policy, multiplier) {
  if (multiplier === 1) return policy;
  return {
    ...policy,
    limit: Math.max(1, Math.floor(policy.limit * multiplier)),
    capacity: policy.capacity ? Math.max(1, Math.floor(policy.capacity * multiplier)) : undefined,
    refillPerSecond: policy.refillPerSecond ? policy.refillPerSecond * multiplier : undefined
  };
}

function emit(observer, event) {
  try {
    observer?.(Object.freeze(event));
  } catch {
    // Observability must never become an availability dependency.
  }
}

export function createRateLimiter({ store, policies, observer, now = () => Date.now() }) {
  if (!store || typeof store.consume !== "function") throw new TypeError("store.consume is required");
  const policyMap = new Map(Object.values(policies ?? {}).map((policy) => {
    const validated = validatePolicy(policy);
    return [validated.name, validated];
  }));

  return Object.freeze({
    async check({ policy: policyName, action, bucketKey, cost = 1, trustedInternalService = null }) {
      const basePolicy = policyMap.get(policyName);
      if (!basePolicy) throw new TypeError(`unknown abuse-protection policy: ${policyName}`);
      if (typeof action !== "string" || !action) throw new TypeError("action is required");
      if (typeof bucketKey !== "string" || !bucketKey) throw new TypeError("bucketKey is required");

      const internalMode = basePolicy.trustedInternal.mode;
      if (trustedInternalService && internalMode === "bypass") {
        const result = Object.freeze({
          allowed: true,
          reason: "trusted_internal_bypass",
          policy: policyName,
          action,
          limit: null,
          remaining: null,
          retryAfterMs: 0,
          retryAfterSeconds: 0,
          resetAt: null
        });
        emit(observer, { type: "decision", ...result, keyFingerprint: fingerprintBucketKey(bucketKey) });
        return result;
      }

      const multiplier = trustedInternalService && internalMode === "separate" ? basePolicy.trustedInternal.multiplier : 1;
      const effectivePolicy = scaledPolicy(basePolicy, multiplier);
      const effectiveKey = trustedInternalService && internalMode === "separate"
        ? `${bucketKey}|internal:${trustedInternalService}`
        : bucketKey;

      try {
        const stored = await store.consume({
          key: effectiveKey,
          algorithm: effectivePolicy.algorithm,
          limit: effectivePolicy.limit,
          windowMs: effectivePolicy.windowMs,
          capacity: effectivePolicy.capacity ?? effectivePolicy.limit,
          refillPerSecond: effectivePolicy.refillPerSecond,
          cost,
          now: now()
        });
        const retryAfterMs = Math.max(0, stored.retryAfterMs ?? 0);
        const result = Object.freeze({
          allowed: Boolean(stored.allowed),
          reason: stored.allowed ? "allowed" : "rate_limited",
          policy: policyName,
          action,
          limit: stored.limit,
          remaining: stored.remaining,
          retryAfterMs,
          retryAfterSeconds: retryAfterMs === 0 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
          resetAt: stored.resetAt ?? null
        });
        emit(observer, { type: "decision", ...result, keyFingerprint: fingerprintBucketKey(effectiveKey) });
        return result;
      } catch (error) {
        const allowed = basePolicy.failMode === "open";
        const result = Object.freeze({
          allowed,
          reason: allowed ? "store_error_fail_open" : "store_error_fail_closed",
          policy: policyName,
          action,
          limit: basePolicy.limit,
          remaining: null,
          retryAfterMs: allowed ? 0 : 1000,
          retryAfterSeconds: allowed ? 0 : 1,
          resetAt: null
        });
        emit(observer, {
          type: "store_error",
          ...result,
          keyFingerprint: fingerprintBucketKey(effectiveKey),
          errorName: error?.name ?? "Error"
        });
        return result;
      }
    }
  });
}
