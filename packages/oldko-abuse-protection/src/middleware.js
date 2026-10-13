export function toRateLimitHeaders(result) {
  const headers = {};
  if (result.limit != null) headers["RateLimit-Limit"] = String(result.limit);
  if (result.remaining != null) headers["RateLimit-Remaining"] = String(result.remaining);
  if (result.resetAt != null) headers["RateLimit-Reset"] = String(Math.ceil(result.resetAt / 1000));
  if (!result.allowed && result.retryAfterSeconds > 0) headers["Retry-After"] = String(result.retryAfterSeconds);
  return headers;
}

export function createProtectionMiddleware({ limiter, policy, action, identify, onDenied }) {
  if (!limiter || typeof limiter.check !== "function") throw new TypeError("limiter.check is required");
  if (typeof identify !== "function") throw new TypeError("identify must be a function");

  return async function protect(context, next) {
    const identity = await identify(context);
    const resolvedAction = typeof action === "function" ? action(context) : action;
    const result = await limiter.check({
      policy,
      action: resolvedAction,
      bucketKey: identity.bucketKey,
      cost: identity.cost ?? 1,
      trustedInternalService: identity.trustedInternalService ?? null
    });

    context.abuseProtection = result;
    if (!result.allowed) {
      if (typeof onDenied === "function") return onDenied(context, result);
      return { status: 429, headers: toRateLimitHeaders(result), body: { error: "rate_limited" } };
    }
    return next(context, result);
  };
}
