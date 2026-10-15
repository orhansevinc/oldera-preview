export const FAILURE_CATEGORIES = Object.freeze([
  'ACCOUNT_API_UNREADY',
  'DATABASE_UNREACHABLE',
  'MIGRATION_MISMATCH',
  'AUTH_GATEWAY_DOWN',
  'GAME_GATEWAY_DOWN',
  'WORLD_NOT_READY',
  'WEBSOCKET_DISCONNECT',
  'CLIENT_ASSET_MISSING',
  'ENTITY_NOT_CREATED',
  'MODEL_LOAD_FAILED',
  'ADMIN_REPOSITORY_UNREADY',
  'ADMIN_RUNTIME_BRIDGE_UNREADY',
  'UNKNOWN'
]);

const LOG_RULES = [
  ['DATABASE_UNREACHABLE', /\b(?:ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b.*(?:postgres|5432)|(?:postgres|database).*(?:unreachable|connection refused|not reachable)/i],
  ['ACCOUNT_API_UNREADY', /account(?:-|_)?api.*(?:unready|not ready|readiness.*fail)/i],
  ['AUTH_GATEWAY_DOWN', /auth.*gateway.*(?:down|unready|unreachable|connection refused)/i],
  ['GAME_GATEWAY_DOWN', /game.*gateway.*(?:down|unready|unreachable|connection refused)/i],
  ['WORLD_NOT_READY', /world.*(?:not ready|unready|bootstrap.*fail)/i],
  ['WEBSOCKET_DISCONNECT', /websocket.*(?:disconnect|closed|close code|ECONNRESET)/i],
  ['CLIENT_ASSET_MISSING', /(?:asset|resource).*(?:404|missing|not found)/i],
  ['ENTITY_NOT_CREATED', /entity.*(?:not created|create.*fail|spawn.*fail)/i],
  ['MODEL_LOAD_FAILED', /(?:model|n3chr|n3cpart|n3anim|n3joint).*(?:load.*fail|failed to load|missing)/i],
  ['ADMIN_REPOSITORY_UNREADY', /admin.*repository.*(?:unready|not ready|missing|fail)/i],
  ['ADMIN_RUNTIME_BRIDGE_UNREADY', /admin.*runtime.*bridge.*(?:unready|not ready|missing|fail)/i]
];

function push(findings, category, source, detail) {
  findings.push({ category, evidence: [{ source, detail }] });
}

function serviceState(health, names) {
  const services = health?.services ?? [];
  return services.find((item) => names.includes(String(item.name ?? item.service ?? '').toLowerCase()));
}

export function classifyIncident(evidence = {}) {
  const findings = [];
  const health = evidence.health ?? {};
  const migrations = evidence.migrations ?? {};

  if (health.postgres?.connectivity === false) push(findings, 'DATABASE_UNREACHABLE', 'health.postgres.connectivity', false);
  if (migrations.expected && migrations.current && migrations.expected !== migrations.current) {
    push(findings, 'MIGRATION_MISMATCH', 'migrations', { expected: migrations.expected, current: migrations.current });
  }

  const serviceRules = [
    ['ACCOUNT_API_UNREADY', ['account-api', 'account_api']],
    ['AUTH_GATEWAY_DOWN', ['auth-gateway', 'auth_gateway']],
    ['GAME_GATEWAY_DOWN', ['game-gateway', 'game_gateway']],
    ['ADMIN_REPOSITORY_UNREADY', ['admin-repository', 'admin_repository']],
    ['ADMIN_RUNTIME_BRIDGE_UNREADY', ['admin-runtime-bridge', 'admin_runtime_bridge']]
  ];
  for (const [category, names] of serviceRules) {
    const service = serviceState(health, names);
    if (service && (service.ready === false || service.status === 'down' || service.health === 'unhealthy')) {
      push(findings, category, `health.services.${service.name ?? service.service}`, service);
    }
  }

  if (health.world_ready === false) push(findings, 'WORLD_NOT_READY', 'health.world_ready', false);

  const logEntries = Array.isArray(evidence.logs) ? evidence.logs : Object.entries(evidence.logs ?? {}).flatMap(([service, value]) => {
    const lines = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
    return lines.filter(Boolean).map((line) => ({ service, line }));
  });
  for (const entry of logEntries) {
    const text = typeof entry === 'string' ? entry : String(entry.line ?? entry.message ?? '');
    for (const [category, pattern] of LOG_RULES) {
      if (pattern.test(text)) {
        push(findings, category, `logs:${entry.service ?? 'unknown'}`, text.slice(0, 500));
        break;
      }
    }
  }

  const browser = evidence.browser_evidence ?? evidence.browserEvidence ?? {};
  if (browser.entity_created === false) push(findings, 'ENTITY_NOT_CREATED', 'browser_evidence.entity_created', false);
  if (browser.model_loaded === false) push(findings, 'MODEL_LOAD_FAILED', 'browser_evidence.model_loaded', false);
  if (browser.asset_missing === true) push(findings, 'CLIENT_ASSET_MISSING', 'browser_evidence.asset_missing', true);
  if (browser.websocket_disconnected === true) push(findings, 'WEBSOCKET_DISCONNECT', 'browser_evidence.websocket_disconnected', true);

  const merged = new Map();
  for (const finding of findings) {
    const existing = merged.get(finding.category);
    if (existing) existing.evidence.push(...finding.evidence);
    else merged.set(finding.category, finding);
  }
  const unique = [...merged.values()];
  return {
    primary: unique[0]?.category ?? 'UNKNOWN',
    findings: unique
  };
}

export const KNOWN_ERROR_SIGNATURES = Object.freeze(LOG_RULES.map(([category, pattern]) => ({ category, pattern: pattern.source, flags: pattern.flags })));
