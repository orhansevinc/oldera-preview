const FIXTURE_PREFIX = "fx:ws49";
const SERIAL_PREFIX = "fxserial:ws49";
export const DEFAULT_SEED = 12980049;

function sanitize(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "fixture";
}

function hash32(input) {
  let hash = 0x811c9dc5;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hashHex(input) {
  return hash32(input).toString(16).padStart(8, "0");
}

export function createDeterministicRandom(seed = DEFAULT_SEED) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fixtureId(namespace, key, seed = DEFAULT_SEED) {
  const ns = sanitize(namespace);
  const normalizedKey = sanitize(key);
  const suffix = hashHex(`${seed}:${ns}:${normalizedKey}`);
  return `${FIXTURE_PREFIX}:${ns}:${normalizedKey}:${suffix}`;
}

export function fixtureSerial(namespace, key, seed = DEFAULT_SEED) {
  const ns = sanitize(namespace);
  const normalizedKey = sanitize(key);
  const suffix = hashHex(`serial:${seed}:${ns}:${normalizedKey}`);
  return `${SERIAL_PREFIX}:${ns}:${normalizedKey}:${suffix}`;
}

export function deterministicInt(scope, seed = DEFAULT_SEED, min = 0, max = 2147483647) {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new TypeError("deterministicInt requires integer min/max with max >= min");
  }
  const span = max - min + 1;
  return min + (hash32(`${seed}:${scope}`) % span);
}

export function createCatalogAdapter(resolve) {
  if (typeof resolve !== "function") {
    throw new TypeError("catalog adapter requires a resolve(ref) function");
  }
  return Object.freeze({ resolve });
}

export function developmentCredential(name, environment = process.env.NODE_ENV) {
  if (environment !== "test" && environment !== "development") {
    throw new Error("test credentials are available only in development/test context");
  }
  if (name !== "osevinc") {
    throw new Error(`unknown test credential: ${name}`);
  }
  return Object.freeze({ username: "osevinc", password: "osevinc", testOnly: true });
}

function markerError(path, message) {
  return `${path}: ${message}`;
}

function validateMarkers(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateMarkers(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") return;

  const markerKeys = Object.keys(value).filter((key) => key.startsWith("$"));
  if (markerKeys.length > 1) {
    errors.push(markerError(path, "marker objects may contain only one $ marker"));
    return;
  }

  if ("$fixtureId" in value) {
    if (!Array.isArray(value.$fixtureId) || value.$fixtureId.length !== 2) {
      errors.push(markerError(path, "$fixtureId must be [namespace, key]"));
    }
    return;
  }
  if ("$serial" in value) {
    if (!Array.isArray(value.$serial) || value.$serial.length !== 2) {
      errors.push(markerError(path, "$serial must be [namespace, key]"));
    }
    return;
  }
  if ("$catalog" in value) {
    if (typeof value.$catalog !== "string" || !value.$catalog.includes(".")) {
      errors.push(markerError(path, "$catalog must be a dotted logical catalog ref"));
    }
    return;
  }
  if ("$testCredential" in value) {
    if (value.$testCredential !== "osevinc") {
      errors.push(markerError(path, "only the explicitly approved osevinc test credential is supported"));
    }
    return;
  }
  if ("$randomInt" in value) {
    const spec = value.$randomInt;
    if (!Array.isArray(spec) || spec.length !== 3 || !Number.isInteger(spec[1]) || !Number.isInteger(spec[2])) {
      errors.push(markerError(path, "$randomInt must be [scope, min, max]"));
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (/id$/i.test(key) && typeof child === "number") {
      errors.push(markerError(`${path}.${key}`, "raw numeric IDs are forbidden; use $fixtureId or $catalog"));
    }
    validateMarkers(child, `${path}.${key}`, errors);
  }
}

export function validateScenarioManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest must be an object"];
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (manifest.testOnly !== true) errors.push("testOnly must be true");
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.category || "")) {
    errors.push("category must be kebab-case");
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0) {
    errors.push("scenarios must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  const seeds = new Set();
  for (const [index, scenario] of manifest.scenarios.entries()) {
    const path = `scenarios[${index}]`;
    if (!scenario || typeof scenario !== "object") {
      errors.push(markerError(path, "scenario must be an object"));
      continue;
    }
    if (!/^ws49\.[a-z-]+\.[a-z0-9-]+$/.test(scenario.id || "")) {
      errors.push(markerError(path, "id must match ws49.<category>.<name>"));
    }
    if (ids.has(scenario.id)) errors.push(markerError(path, `duplicate id ${scenario.id}`));
    ids.add(scenario.id);
    if (!Number.isInteger(scenario.seed)) errors.push(markerError(path, "seed must be an integer"));
    if (seeds.has(scenario.seed)) errors.push(markerError(path, `duplicate seed ${scenario.seed}`));
    seeds.add(scenario.seed);
    if (typeof scenario.description !== "string" || scenario.description.length < 8) {
      errors.push(markerError(path, "description is required"));
    }
    if (!scenario.payload || typeof scenario.payload !== "object" || Array.isArray(scenario.payload)) {
      errors.push(markerError(path, "payload must be an object"));
    } else {
      validateMarkers(scenario.payload, `${path}.payload`, errors);
    }
  }
  return errors;
}

function materializeValue(value, context, path = "payload") {
  if (Array.isArray(value)) return value.map((entry, index) => materializeValue(entry, context, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;

  if ("$fixtureId" in value) {
    const [namespace, key] = value.$fixtureId;
    return fixtureId(namespace, key, context.seed);
  }
  if ("$serial" in value) {
    const [namespace, key] = value.$serial;
    return fixtureSerial(namespace, key, context.seed);
  }
  if ("$testCredential" in value) {
    return developmentCredential(value.$testCredential, context.environment);
  }
  if ("$randomInt" in value) {
    const [scope, min, max] = value.$randomInt;
    return deterministicInt(scope, context.seed, min, max);
  }
  if ("$catalog" in value) {
    const ref = value.$catalog;
    if (!context.catalogAdapter) {
      if (context.strictCatalog) throw new Error(`unresolved WS31 catalog ref at ${path}: ${ref}`);
      return Object.freeze({ source: "WS31_CATALOG_REF", ref, unresolved: true });
    }
    const resolved = context.catalogAdapter.resolve(ref);
    if (resolved === undefined || resolved === null) {
      throw new Error(`WS31 catalog adapter could not resolve ${ref}`);
    }
    return Object.freeze({ source: "WS31_CATALOG", ref, value: resolved });
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, materializeValue(child, context, `${path}.${key}`)])
  );
}

export function materializeScenario(scenario, options = {}) {
  if (!scenario || typeof scenario !== "object") throw new TypeError("scenario is required");
  const seed = Number.isInteger(scenario.seed) ? scenario.seed : DEFAULT_SEED;
  const payload = materializeValue(scenario.payload || {}, {
    seed,
    catalogAdapter: options.catalogAdapter || null,
    strictCatalog: options.strictCatalog === true,
    environment: options.environment || "test"
  });
  return Object.freeze({
    id: scenario.id,
    description: scenario.description,
    seed,
    testOnly: true,
    payload
  });
}

export function flattenScenarioManifests(manifests) {
  const scenarios = [];
  const ids = new Set();
  for (const manifest of manifests) {
    const errors = validateScenarioManifest(manifest);
    if (errors.length) throw new Error(`invalid fixture manifest: ${errors.join("; ")}`);
    for (const scenario of manifest.scenarios) {
      if (ids.has(scenario.id)) throw new Error(`duplicate scenario across manifests: ${scenario.id}`);
      ids.add(scenario.id);
      scenarios.push(scenario);
    }
  }
  return Object.freeze(scenarios);
}
