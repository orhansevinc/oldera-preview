export const DEFAULT_ABUSE_POLICIES = Object.freeze({
  loginAttempts: Object.freeze({
    name: "login-attempts",
    algorithm: "sliding-window",
    limit: 8,
    windowMs: 15 * 60_000,
    failMode: "closed",
    trustedInternal: { mode: "same" }
  }),
  registration: Object.freeze({
    name: "registration",
    algorithm: "fixed-window",
    limit: 5,
    windowMs: 60 * 60_000,
    failMode: "closed",
    trustedInternal: { mode: "same" }
  }),
  passwordReset: Object.freeze({
    name: "password-reset",
    algorithm: "sliding-window",
    limit: 5,
    windowMs: 60 * 60_000,
    failMode: "closed",
    trustedInternal: { mode: "same" }
  }),
  adminMutation: Object.freeze({
    name: "admin-mutation",
    algorithm: "token-bucket",
    limit: 30,
    capacity: 30,
    refillPerSecond: 0.5,
    failMode: "closed",
    trustedInternal: { mode: "separate", multiplier: 4 }
  }),
  publicSearchRanking: Object.freeze({
    name: "public-search-ranking",
    algorithm: "token-bucket",
    limit: 60,
    capacity: 60,
    refillPerSecond: 2,
    failMode: "open",
    trustedInternal: { mode: "separate", multiplier: 4 }
  }),
  websocketConnect: Object.freeze({
    name: "websocket-connect",
    algorithm: "sliding-window",
    limit: 20,
    windowMs: 60_000,
    failMode: "closed",
    trustedInternal: { mode: "same" }
  }),
  malformedRequestStorm: Object.freeze({
    name: "malformed-request-storm",
    algorithm: "fixed-window",
    limit: 30,
    windowMs: 60_000,
    failMode: "closed",
    trustedInternal: { mode: "same" }
  }),
  commandBusCalls: Object.freeze({
    name: "command-bus-calls",
    algorithm: "token-bucket",
    limit: 120,
    capacity: 120,
    refillPerSecond: 4,
    failMode: "closed",
    trustedInternal: { mode: "separate", multiplier: 4 }
  })
});
