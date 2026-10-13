export type RateLimitAlgorithm = "fixed-window" | "sliding-window" | "token-bucket";
export type FailMode = "open" | "closed";
export type TrustedInternalMode = "same" | "separate" | "bypass";

export interface RateLimitPolicy {
  name: string;
  algorithm: RateLimitAlgorithm;
  limit: number;
  windowMs?: number;
  capacity?: number;
  refillPerSecond?: number;
  failMode: FailMode;
  trustedInternal?: { mode?: TrustedInternalMode; multiplier?: number };
}

export interface StoreConsumeRequest extends RateLimitPolicy {
  key: string;
  cost?: number;
  now?: number;
}

export interface StoreConsumeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  resetAt: number | null;
}

export interface DistributedRateLimitStore {
  consume(request: StoreConsumeRequest): Promise<StoreConsumeResult>;
}

export interface RateLimitDecision extends StoreConsumeResult {
  reason: "allowed" | "rate_limited" | "store_error_fail_open" | "store_error_fail_closed" | "trusted_internal_bypass";
  policy: string;
  action: string;
  retryAfterSeconds: number;
}

export class InMemoryRateLimitStore implements DistributedRateLimitStore {
  constructor(options?: { now?: () => number });
  consume(request: StoreConsumeRequest): Promise<StoreConsumeResult>;
  clear(): void;
}

export function createKeyBuilder(options: { hmacSecret: string; namespace?: string }): {
  ip(rawIp: string): string;
  account(accountId: string): string;
  actor(actorId: string): string;
  service(serviceId: string): string;
  compose(input: { policy: string; action: string; keys: string[] }): string;
};
export function fingerprintBucketKey(bucketKey: string): string;

export function exactTrustedProxies(addresses?: string[]): (address: string, hopIndex?: number) => boolean;
export function resolveClientIp(
  request: { remoteAddress: string; headers?: Record<string, string | undefined> },
  options?: { trustProxy?: (address: string, hopIndex: number) => boolean }
): { ip: string; source: "socket" | "x-forwarded-for"; forwardedAccepted: boolean; hopCount: number };

export function validatePolicy(policy: RateLimitPolicy): Readonly<RateLimitPolicy>;
export function createRateLimiter(options: {
  store: DistributedRateLimitStore;
  policies: Record<string, RateLimitPolicy>;
  observer?: (event: Record<string, unknown>) => void;
  now?: () => number;
}): {
  check(input: {
    policy: string;
    action: string;
    bucketKey: string;
    cost?: number;
    trustedInternalService?: string | null;
  }): Promise<RateLimitDecision>;
};

export function toRateLimitHeaders(result: RateLimitDecision): Record<string, string>;
export function createProtectionMiddleware(options: {
  limiter: ReturnType<typeof createRateLimiter>;
  policy: string;
  action: string | ((context: any) => string);
  identify: (context: any) => Promise<{ bucketKey: string; cost?: number; trustedInternalService?: string | null }> | { bucketKey: string; cost?: number; trustedInternalService?: string | null };
  onDenied?: (context: any, result: RateLimitDecision) => any;
}): (context: any, next: (context: any, result: RateLimitDecision) => any) => Promise<any>;
