import net from "node:net";
import {
  DEFAULTS,
  ENVIRONMENTS,
  KNOWN_ENV_KEYS,
  RESERVED_LITERAL_SECRET_KEYS,
  SECRET_REFERENCE_PATTERN
} from "./schema.js";

const BOOLEAN_VALUES = new Map([
  ["true", true],
  ["false", false],
  ["1", true],
  ["0", false]
]);

const SECRET_NAME_PATTERN = /(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|CREDENTIAL)/i;

export class ConfigValidationError extends Error {
  constructor(issues) {
    const message = [
      "OldKOWeb runtime configuration is invalid:",
      ...issues.map((issue) => `- ${issue.key}: ${issue.message}`)
    ].join("\n");
    super(message);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

function pushIssue(issues, key, message) {
  issues.push({ key, message });
}

function normalize(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

function readRequiredString(source, key, issues) {
  const value = normalize(source[key]);
  if (value === undefined) pushIssue(issues, key, "is required");
  return value;
}

function readOptionalString(source, key) {
  return normalize(source[key]);
}

function readEnum(source, key, values, issues, { required = false, fallback } = {}) {
  const value = normalize(source[key]);
  if (value === undefined) {
    if (required && fallback === undefined) pushIssue(issues, key, "is required");
    return fallback;
  }
  if (!values.includes(value)) {
    pushIssue(issues, key, `must be one of: ${values.join(", ")}`);
    return fallback;
  }
  return value;
}

function readBoolean(source, key, issues, fallback) {
  const value = normalize(source[key]);
  if (value === undefined) return fallback;
  const parsed = BOOLEAN_VALUES.get(value.toLowerCase());
  if (parsed === undefined) {
    pushIssue(issues, key, "must be true, false, 1, or 0");
    return fallback;
  }
  return parsed;
}

function readInteger(source, key, issues, { min, max, required = false, fallback } = {}) {
  const value = normalize(source[key]);
  if (value === undefined) {
    if (required && fallback === undefined) pushIssue(issues, key, "is required");
    return fallback;
  }
  if (!/^-?\d+$/.test(value)) {
    pushIssue(issues, key, "must be an integer");
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    pushIssue(issues, key, `must be between ${min} and ${max}`);
    return fallback;
  }
  return parsed;
}

function isValidHostname(host) {
  if (net.isIP(host)) return true;
  if (host.length > 253 || host.includes("/") || host.includes("://")) return false;
  const labels = host.split(".");
  return labels.every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

function readHost(source, key, issues, { required = false, fallback } = {}) {
  const value = normalize(source[key]);
  if (value === undefined) {
    if (required && fallback === undefined) pushIssue(issues, key, "is required");
    return fallback;
  }
  if (!isValidHostname(value)) {
    pushIssue(issues, key, "must be a hostname or IP address without a scheme or path");
    return fallback;
  }
  return value;
}

function parseHttpUrl(raw, key, issues, { originOnly = false } = {}) {
  if (raw === undefined) return undefined;
  let url;
  try {
    url = new URL(raw);
  } catch {
    pushIssue(issues, key, "must be a valid URL");
    return undefined;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    pushIssue(issues, key, "must use http:// or https://");
    return undefined;
  }
  if (url.username || url.password) {
    pushIssue(issues, key, "must not contain embedded credentials");
    return undefined;
  }
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    pushIssue(issues, key, "must be an origin only (scheme + host + optional port)");
    return undefined;
  }
  return originOnly ? url.origin : url.toString().replace(/\/$/, "");
}

function readUrl(source, key, issues, { required = false, originOnly = false } = {}) {
  const raw = normalize(source[key]);
  if (raw === undefined) {
    if (required) pushIssue(issues, key, "is required");
    return undefined;
  }
  return parseHttpUrl(raw, key, issues, { originOnly });
}

function readPairedEndpoint(source, hostKey, portKey, issues) {
  const hostRaw = normalize(source[hostKey]);
  const portRaw = normalize(source[portKey]);
  if (hostRaw === undefined && portRaw === undefined) return undefined;
  const host = readHost(source, hostKey, issues, { required: true });
  const port = readInteger(source, portKey, issues, {
    min: 1,
    max: 65535,
    required: true
  });
  return host && port ? { host, port } : undefined;
}

function readSecretSource(source, refKey, literalKey, envName, issues) {
  const reference = normalize(source[refKey]);
  const literal = normalize(source[literalKey]);

  if (reference && literal) {
    pushIssue(issues, refKey, `must not be set together with ${literalKey}`);
    return undefined;
  }

  if (reference) {
    if (!SECRET_REFERENCE_PATTERN.test(reference)) {
      pushIssue(
        issues,
        refKey,
        "must use env://NAME, file:///absolute/path, or secret://provider/key"
      );
      return undefined;
    }
    return { kind: "reference", reference };
  }

  if (literal) {
    if (envName === "production") {
      pushIssue(
        issues,
        literalKey,
        `literal secrets are forbidden in production; use ${refKey}`
      );
      return undefined;
    }
    return { kind: "literal", value: literal };
  }

  return undefined;
}

function readTrustedOrigins(source, envName, corsCredentials, issues) {
  const raw = normalize(source.OLDKO_TRUSTED_ORIGINS);
  if (raw === undefined) return [];

  const entries = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = [];
  for (const entry of entries) {
    if (entry === "*") {
      if (envName === "production") {
        pushIssue(issues, "OLDKO_TRUSTED_ORIGINS", "wildcard origin is forbidden in production");
      } else if (corsCredentials) {
        pushIssue(
          issues,
          "OLDKO_TRUSTED_ORIGINS",
          "wildcard origin cannot be used when CORS credentials are enabled"
        );
      } else if (!unique.includes(entry)) {
        unique.push(entry);
      }
      continue;
    }

    const parsed = parseHttpUrl(entry, "OLDKO_TRUSTED_ORIGINS", issues, {
      originOnly: true
    });
    if (parsed && !unique.includes(parsed)) unique.push(parsed);
  }

  return unique;
}

function normalizeFeatureFlagName(suffix) {
  return suffix
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
    )
    .join("");
}

function readFeatureFlags(source, issues) {
  const flags = {};
  for (const [key] of Object.entries(source)) {
    if (!key.startsWith("OLDKO_FF_")) continue;
    const suffix = key.slice("OLDKO_FF_".length);
    if (!/^[A-Z][A-Z0-9_]*$/.test(suffix)) {
      pushIssue(issues, key, "feature flag names must use uppercase letters, digits, and underscores");
      continue;
    }
    const value = readBoolean(source, key, issues, undefined);
    if (value !== undefined) flags[normalizeFeatureFlagName(suffix)] = value;
  }
  return flags;
}

function validateUnknownKeys(source, issues, allowUnknown) {
  if (allowUnknown) return;
  const known = new Set(KNOWN_ENV_KEYS);
  for (const key of Object.keys(source)) {
    if (!key.startsWith("OLDKO_") || key.startsWith("OLDKO_FF_")) continue;
    if (!known.has(key)) pushIssue(issues, key, "is not part of the central runtime config contract");
  }
}

function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

export function loadConfig(source = process.env, options = {}) {
  const issues = [];
  const allowUnknown = options.allowUnknown === true;

  validateUnknownKeys(source, issues, allowUnknown);

  const env = readEnum(source, "OLDKO_ENV", ENVIRONMENTS, issues, { required: true });
  const serviceName = readRequiredString(source, "OLDKO_SERVICE_NAME", issues);
  if (serviceName && !/^[a-z][a-z0-9-]{1,62}$/.test(serviceName)) {
    pushIssue(
      issues,
      "OLDKO_SERVICE_NAME",
      "must be 2-63 lowercase letters, digits, or hyphens and start with a letter"
    );
  }

  const serviceHost = readHost(source, "OLDKO_SERVICE_HOST", issues, {
    fallback: DEFAULTS.serviceHost
  });
  const servicePort = readInteger(source, "OLDKO_SERVICE_PORT", issues, {
    min: 1,
    max: 65535
  });

  const dbEnabled = readBoolean(source, "OLDKO_DB_ENABLED", issues, false);
  const dbDriver = dbEnabled
    ? readEnum(source, "OLDKO_DB_DRIVER", ["postgres", "mssql"], issues, { required: true })
    : readEnum(source, "OLDKO_DB_DRIVER", ["postgres", "mssql"], issues);
  const dbHost = readHost(source, "OLDKO_DB_HOST", issues, { required: dbEnabled });
  const dbPort = readInteger(source, "OLDKO_DB_PORT", issues, {
    min: 1,
    max: 65535,
    required: dbEnabled,
    fallback: dbEnabled && dbDriver ? (dbDriver === "postgres" ? 5432 : 1433) : undefined
  });
  const dbName = dbEnabled
    ? readRequiredString(source, "OLDKO_DB_NAME", issues)
    : readOptionalString(source, "OLDKO_DB_NAME");
  const dbUser = dbEnabled
    ? readRequiredString(source, "OLDKO_DB_USER", issues)
    : readOptionalString(source, "OLDKO_DB_USER");
  const dbPassword = readSecretSource(
    source,
    "OLDKO_DB_PASSWORD_REF",
    "OLDKO_DB_PASSWORD",
    env,
    issues
  );
  if (dbEnabled && !dbPassword) {
    pushIssue(issues, "OLDKO_DB_PASSWORD_REF", "a database secret source is required when DB is enabled");
  }

  const gatewayEnabled = readBoolean(source, "OLDKO_GATEWAY_ENABLED", issues, false);
  const gatewayAuthTargetUrl = readUrl(source, "OLDKO_GATEWAY_AUTH_TARGET_URL", issues, {
    required: gatewayEnabled
  });
  const gatewayGameTargetUrl = readUrl(source, "OLDKO_GATEWAY_GAME_TARGET_URL", issues, {
    required: gatewayEnabled
  });

  const authEndpoint = readPairedEndpoint(source, "OLDKO_AUTH_HOST", "OLDKO_AUTH_PORT", issues);
  const gameEndpoint = readPairedEndpoint(source, "OLDKO_GAME_HOST", "OLDKO_GAME_PORT", issues);

  const adminApiEnabled = readBoolean(source, "OLDKO_ADMIN_API_ENABLED", issues, false);
  const adminApiHost = readHost(source, "OLDKO_ADMIN_API_HOST", issues, {
    required: adminApiEnabled,
    fallback: adminApiEnabled ? "127.0.0.1" : undefined
  });
  const adminApiPort = readInteger(source, "OLDKO_ADMIN_API_PORT", issues, {
    min: 1,
    max: 65535,
    required: adminApiEnabled,
    fallback: adminApiEnabled ? 8787 : undefined
  });
  const adminApiBaseUrl = readUrl(source, "OLDKO_ADMIN_API_BASE_URL", issues, {
    required: adminApiEnabled
  });
  const adminSessionSecret = readSecretSource(
    source,
    "OLDKO_ADMIN_SESSION_SECRET_REF",
    "OLDKO_ADMIN_SESSION_SECRET",
    env,
    issues
  );
  const gameCommandToken = readSecretSource(
    source,
    "OLDKO_GAME_COMMAND_TOKEN_REF",
    "OLDKO_GAME_COMMAND_TOKEN",
    env,
    issues
  );

  const logLevel = readEnum(
    source,
    "OLDKO_LOG_LEVEL",
    ["trace", "debug", "info", "warn", "error", "fatal"],
    issues,
    { fallback: DEFAULTS.logLevel }
  );
  const logJson = readBoolean(source, "OLDKO_LOG_JSON", issues, DEFAULTS.logJson);
  const metricsEnabled = readBoolean(source, "OLDKO_METRICS_ENABLED", issues, DEFAULTS.metricsEnabled);
  const metricsHost = readHost(source, "OLDKO_METRICS_HOST", issues, {
    required: metricsEnabled,
    fallback: DEFAULTS.metricsHost
  });
  const metricsPort = readInteger(source, "OLDKO_METRICS_PORT", issues, {
    min: 1,
    max: 65535,
    required: metricsEnabled
  });
  const healthPath = readOptionalString(source, "OLDKO_HEALTH_PATH") ?? DEFAULTS.healthPath;
  if (!healthPath.startsWith("/") || healthPath.includes(" ")) {
    pushIssue(issues, "OLDKO_HEALTH_PATH", "must start with / and contain no spaces");
  }

  const corsCredentials = readBoolean(source, "OLDKO_CORS_CREDENTIALS", issues, DEFAULTS.corsCredentials);
  const trustedOrigins = readTrustedOrigins(source, env, corsCredentials, issues);

  const startupTimeoutMs = readInteger(source, "OLDKO_STARTUP_TIMEOUT_MS", issues, {
    min: 100,
    max: 300000,
    fallback: DEFAULTS.startupTimeoutMs
  });
  const requestTimeoutMs = readInteger(source, "OLDKO_REQUEST_TIMEOUT_MS", issues, {
    min: 100,
    max: 120000,
    fallback: DEFAULTS.requestTimeoutMs
  });
  const dbTimeoutMs = readInteger(source, "OLDKO_DB_TIMEOUT_MS", issues, {
    min: 100,
    max: 120000,
    fallback: DEFAULTS.dbTimeoutMs
  });
  const gatewayTimeoutMs = readInteger(source, "OLDKO_GATEWAY_TIMEOUT_MS", issues, {
    min: 100,
    max: 120000,
    fallback: DEFAULTS.gatewayTimeoutMs
  });

  const featureFlags = readFeatureFlags(source, issues);

  if (env === "production") {
    for (const key of RESERVED_LITERAL_SECRET_KEYS) {
      if (normalize(source[key]) !== undefined && !issues.some((issue) => issue.key === key)) {
        pushIssue(issues, key, "literal secrets are forbidden in production");
      }
    }
  }

  if (issues.length > 0) throw new ConfigValidationError(issues);

  return freezeDeep({
    env,
    service: { name: serviceName, host: serviceHost, port: servicePort },
    database: {
      enabled: dbEnabled,
      driver: dbDriver,
      host: dbHost,
      port: dbPort,
      name: dbName,
      user: dbUser,
      password: dbPassword
    },
    gateway: {
      enabled: gatewayEnabled,
      authTargetUrl: gatewayAuthTargetUrl,
      gameTargetUrl: gatewayGameTargetUrl
    },
    network: { auth: authEndpoint, game: gameEndpoint },
    adminApi: {
      enabled: adminApiEnabled,
      host: adminApiHost,
      port: adminApiPort,
      baseUrl: adminApiBaseUrl,
      sessionSecret: adminSessionSecret,
      gameCommandToken
    },
    observability: {
      logLevel,
      logJson,
      metrics: { enabled: metricsEnabled, host: metricsHost, port: metricsPort },
      healthPath
    },
    cors: { trustedOrigins, credentials: corsCredentials },
    timeouts: {
      startupMs: startupTimeoutMs,
      requestMs: requestTimeoutMs,
      databaseMs: dbTimeoutMs,
      gatewayMs: gatewayTimeoutMs
    },
    featureFlags
  });
}

export function redactEnv(source = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] =
      SECRET_NAME_PATTERN.test(key) || key.endsWith("_REF")
        ? value === undefined
          ? value
          : "[REDACTED]"
        : value;
  }
  return result;
}

export function redactConfig(config) {
  const visit = (value, key = "") => {
    if (Array.isArray(value)) return value.map((item) => visit(item));
    if (!value || typeof value !== "object") {
      return SECRET_NAME_PATTERN.test(key) || /reference/i.test(key) ? "[REDACTED]" : value;
    }
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (
        SECRET_NAME_PATTERN.test(childKey) ||
        /^(password|sessionSecret|gameCommandToken|reference|value)$/i.test(childKey)
      ) {
        result[childKey] = childValue === undefined ? childValue : "[REDACTED]";
      } else {
        result[childKey] = visit(childValue, childKey);
      }
    }
    return result;
  };
  return visit(config);
}

export {
  DEFAULTS,
  ENVIRONMENTS,
  KNOWN_ENV_KEYS,
  RESERVED_LITERAL_SECRET_KEYS,
  SECRET_REFERENCE_PATTERN
} from "./schema.js";
