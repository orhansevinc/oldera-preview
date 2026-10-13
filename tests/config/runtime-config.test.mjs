import assert from "node:assert/strict";
import test from "node:test";

import {
  ConfigValidationError,
  loadConfig,
  redactConfig,
  redactEnv
} from "../../packages/oldko-config/src/index.js";

function validBase(overrides = {}) {
  return {
    OLDKO_ENV: "test",
    OLDKO_SERVICE_NAME: "config-test",
    ...overrides
  };
}

test("loads minimum config with defaults and freezes it", () => {
  const config = loadConfig(validBase());
  assert.equal(config.env, "test");
  assert.equal(config.service.host, "127.0.0.1");
  assert.equal(config.observability.logLevel, "info");
  assert.equal(config.timeouts.requestMs, 15000);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.timeouts));
});

test("fails when required identity is missing", () => {
  assert.throws(
    () => loadConfig({ OLDKO_ENV: "test" }),
    (error) =>
      error instanceof ConfigValidationError &&
      error.issues.some((issue) => issue.key === "OLDKO_SERVICE_NAME")
  );
});

test("validates integer ranges and ports", () => {
  assert.throws(
    () =>
      loadConfig(
        validBase({
          OLDKO_SERVICE_PORT: "70000",
          OLDKO_REQUEST_TIMEOUT_MS: "50"
        })
      ),
    (error) =>
      error.issues.some((issue) => issue.key === "OLDKO_SERVICE_PORT") &&
      error.issues.some((issue) => issue.key === "OLDKO_REQUEST_TIMEOUT_MS")
  );
});

test("validates host and paired raw endpoints", () => {
  assert.throws(
    () => loadConfig(validBase({ OLDKO_AUTH_HOST: "http://127.0.0.1" })),
    (error) =>
      error.issues.some((issue) => issue.key === "OLDKO_AUTH_HOST") &&
      error.issues.some((issue) => issue.key === "OLDKO_AUTH_PORT")
  );
});

test("gateway enabled requires valid auth and game target URLs", () => {
  assert.throws(
    () =>
      loadConfig(
        validBase({
          OLDKO_GATEWAY_ENABLED: "true",
          OLDKO_GATEWAY_AUTH_TARGET_URL: "ftp://bad.example"
        })
      ),
    (error) =>
      error.issues.some((issue) => issue.key === "OLDKO_GATEWAY_AUTH_TARGET_URL") &&
      error.issues.some((issue) => issue.key === "OLDKO_GATEWAY_GAME_TARGET_URL")
  );
});

test("database contract supplies driver port default and secret reference", () => {
  const config = loadConfig(
    validBase({
      OLDKO_DB_ENABLED: "true",
      OLDKO_DB_DRIVER: "mssql",
      OLDKO_DB_HOST: "db.internal",
      OLDKO_DB_NAME: "KN_online",
      OLDKO_DB_USER: "svc_oldko",
      OLDKO_DB_PASSWORD_REF: "env://TEST_DB_PASSWORD"
    })
  );
  assert.equal(config.database.port, 1433);
  assert.deepEqual(config.database.password, {
    kind: "reference",
    reference: "env://TEST_DB_PASSWORD"
  });
});

test("production rejects literal secrets", () => {
  assert.throws(
    () =>
      loadConfig(
        validBase({
          OLDKO_ENV: "production",
          OLDKO_DB_ENABLED: "true",
          OLDKO_DB_DRIVER: "postgres",
          OLDKO_DB_HOST: "db.internal",
          OLDKO_DB_NAME: "oldko",
          OLDKO_DB_USER: "svc",
          OLDKO_DB_PASSWORD: "do-not-log-me"
        })
      ),
    (error) =>
      error.issues.some(
        (issue) =>
          issue.key === "OLDKO_DB_PASSWORD" &&
          issue.message.includes("forbidden in production")
      )
  );
});

test("production accepts secret references", () => {
  const config = loadConfig(
    validBase({
      OLDKO_ENV: "production",
      OLDKO_DB_ENABLED: "true",
      OLDKO_DB_DRIVER: "postgres",
      OLDKO_DB_HOST: "db.internal",
      OLDKO_DB_NAME: "oldko",
      OLDKO_DB_USER: "svc",
      OLDKO_DB_PASSWORD_REF: "secret://deployment/db-password"
    })
  );
  assert.equal(config.database.password.kind, "reference");
});

test("trusted origins are normalized, deduplicated, and origin-only", () => {
  const config = loadConfig(
    validBase({
      OLDKO_TRUSTED_ORIGINS:
        "https://admin.oldkoweb.com,https://admin.oldkoweb.com,http://localhost:5500"
    })
  );
  assert.deepEqual(config.cors.trustedOrigins, [
    "https://admin.oldkoweb.com",
    "http://localhost:5500"
  ]);

  assert.throws(
    () => loadConfig(validBase({ OLDKO_TRUSTED_ORIGINS: "https://admin.oldkoweb.com/path" })),
    (error) => error.issues.some((issue) => issue.key === "OLDKO_TRUSTED_ORIGINS")
  );
});

test("production forbids wildcard CORS and credentials forbid wildcard everywhere", () => {
  assert.throws(
    () => loadConfig(validBase({ OLDKO_ENV: "production", OLDKO_TRUSTED_ORIGINS: "*" })),
    ConfigValidationError
  );

  assert.throws(
    () => loadConfig(validBase({ OLDKO_TRUSTED_ORIGINS: "*", OLDKO_CORS_CREDENTIALS: "true" })),
    ConfigValidationError
  );
});

test("feature flags are typed booleans", () => {
  const config = loadConfig(
    validBase({
      OLDKO_FF_NEW_LOGIN_FLOW: "true",
      OLDKO_FF_SAFE_MERCHANT: "0"
    })
  );
  assert.deepEqual(config.featureFlags, { newLoginFlow: true, safeMerchant: false });
});

test("unknown OLDKO keys fail fast but non-OLDKO process keys are ignored", () => {
  assert.throws(
    () => loadConfig(validBase({ OLDKO_SERVCE_PORT: "8787" })),
    (error) => error.issues.some((issue) => issue.key === "OLDKO_SERVCE_PORT")
  );

  const config = loadConfig(validBase({ PATH: "/usr/bin" }));
  assert.equal(config.service.name, "config-test");
});

test("redaction masks secrets and references without exposing values in validation messages", () => {
  const env = {
    OLDKO_ENV: "test",
    OLDKO_SERVICE_NAME: "config-test",
    OLDKO_DB_PASSWORD: "super-secret",
    OLDKO_DB_PASSWORD_REF: "env://PASSWORD_SOURCE",
    HARMLESS: "visible"
  };
  const redactedEnv = redactEnv(env);
  assert.equal(redactedEnv.OLDKO_DB_PASSWORD, "[REDACTED]");
  assert.equal(redactedEnv.OLDKO_DB_PASSWORD_REF, "[REDACTED]");
  assert.equal(redactedEnv.HARMLESS, "visible");

  assert.throws(
    () => loadConfig(env),
    (error) => !error.message.includes("super-secret")
  );

  const config = loadConfig(validBase({ OLDKO_ADMIN_SESSION_SECRET: "dev-only-value" }));
  const redactedConfig = redactConfig(config);
  assert.equal(redactedConfig.adminApi.sessionSecret, "[REDACTED]");
});

test("admin and observability sections validate enabled requirements", () => {
  const config = loadConfig(
    validBase({
      OLDKO_ADMIN_API_ENABLED: "true",
      OLDKO_ADMIN_API_BASE_URL: "http://127.0.0.1:8787",
      OLDKO_METRICS_ENABLED: "true",
      OLDKO_METRICS_PORT: "9090"
    })
  );
  assert.equal(config.adminApi.host, "127.0.0.1");
  assert.equal(config.adminApi.port, 8787);
  assert.equal(config.observability.metrics.port, 9090);
});
