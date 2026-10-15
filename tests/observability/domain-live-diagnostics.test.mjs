import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redact, sanitizeText } from '../../packages/oldko-observability/src/redaction.js';
import { createDiagnosticCorrelation, hashAccountCorrelation, makeFlowEvent } from '../../packages/oldko-observability/src/correlation.js';
import { classifyIncident } from '../../packages/oldko-observability/src/classification.js';
import { createIncidentBundle } from '../../packages/oldko-observability/src/incident-bundle.js';
import { releaseIdentityFromHandoff } from '../../packages/oldko-observability/src/identity.js';

const secrets = {
  password: 'P@ssw0rd-EXACT-91',
  auth: 'Bearer eyJhbGciOiJub25l.TEST.SIGN',
  cookie: 'oldko_session=SESSION-COOKIE-991',
  csrf: 'CSRF-EXACT-332',
  verify: 'VERIFY-EXACT-443',
  reset: 'RESET-EXACT-554',
  webhook: 'WEBHOOK-EXACT-665',
  dbpass: 'DBPASS-EXACT-776',
  tunnel: 'TUNNEL-EXACT-887',
  admin: 'ADMIN-EXACT-998'
};

test('redaction covers nested keys, headers, query, JSON-like strings and credential URLs', () => {
  const input = {
    password: secrets.password,
    nested: {
      csrf_value: secrets.csrf,
      verificationToken: secrets.verify,
      password_reset_token: secrets.reset,
      delivery_webhook_secret: secrets.webhook,
      tunnel_token: secrets.tunnel,
      admin_session_secret: secrets.admin,
      DATABASE_URL: `postgres://oldko:${secrets.dbpass}@db:5432/oldko`
    },
    text: [
      `Authorization: ${secrets.auth}`,
      `Cookie: ${secrets.cookie}`,
      `Set-Cookie: ${secrets.cookie}; HttpOnly`,
      `https://x.test/path?verification_token=${secrets.verify}&password=${secrets.password}`,
      `csrf_token=${secrets.csrf} password_reset_token=${secrets.reset}`,
      `database_url=postgres://oldko:${secrets.dbpass}@db:5432/oldko`,
      `delivery_webhook_secret=${secrets.webhook}; tunnel_token=${secrets.tunnel}`
    ].join('\n')
  };
  const output = JSON.stringify(redact(input));
  for (const secret of Object.values(secrets)) assert.equal(output.includes(secret.replace(/^Bearer\s+/, '')), false, secret);
  assert.match(output, /\[REDACTED\]/);
});

test('plain text bearer and URL credentials are removed', () => {
  const value = sanitizeText('Bearer ABCDEF.12345 token=TOKEN-X postgres://user:pass@host/db');
  assert.equal(value.includes('ABCDEF.12345'), false);
  assert.equal(value.includes('TOKEN-X'), false);
  assert.equal(value.includes('user:pass'), false);
});

test('correlation contract uses safe opaque refs and hashed account correlation', () => {
  const releaseId = 'oldkoweb-domain-live-20261015';
  const a = hashAccountCorrelation('orhan@example.test', { releaseId });
  const b = hashAccountCorrelation('orhan@example.test', { releaseId });
  assert.equal(a, b);
  assert.notEqual(a, 'orhan@example.test');
  const c = createDiagnosticCorrelation({ release_id: releaseId, request_id: 'req-1', session_ref: 'sess-ref-1', account_id: 'orhan@example.test', character_id: 'char-1', game_connection_id: 'game-1', runtime_target_id: 'mob-800', admin_command_id: 'cmd-1' });
  assert.equal(c.request_id, 'req-1');
  assert.equal(c.account_hash, a);
  assert.equal('account_id' in c, false);
  const event = makeFlowEvent('combat', 'slash', c, { skill_id: 1010 });
  assert.equal(event.stage, 'slash');
});

test('release identity accepts exact source commit and provider set but not moving branch head', () => {
  const id = releaseIdentityFromHandoff({ release_id: 'oldkoweb-domain-live-20261015', source_commit: 'a'.repeat(40), branch: 'moving-branch', input_pins: { parent_provider_set: 'WS50-C5@sha256:abc', client_artifact: 123, client_digest: 'sha256:def' } });
  assert.equal(id.release_id, 'oldkoweb-domain-live-20261015');
  assert.equal(id.provider_set, 'WS50-C5@sha256:abc');
  assert.equal(id.coordinator_source_commit, 'a'.repeat(40));
  assert.equal(JSON.stringify(id).includes('moving-branch'), false);
});

test('classification is evidence-based and UNKNOWN without evidence', () => {
  assert.equal(classifyIncident({}).primary, 'UNKNOWN');
  assert.equal(classifyIncident({ health: { postgres: { connectivity: false }, services: [] } }).primary, 'DATABASE_UNREACHABLE');
  assert.equal(classifyIncident({ migrations: { expected: '0004_admin_persistence', current: '0003_public_account_api' } }).primary, 'MIGRATION_MISMATCH');
  assert.equal(classifyIncident({ logs: { game: 'WebSocket disconnect close code 1006' } }).primary, 'WEBSOCKET_DISCONNECT');
  assert.equal(classifyIncident({ browser_evidence: { model_loaded: false } }).primary, 'MODEL_LOAD_FAILED');
});

test('broken account service is classified from readiness evidence without guessing', () => {
  const result = classifyIncident({
    health: { services: [{ name: 'account-api', ready: false, status_code: 503 }], postgres: { connectivity: true } },
    migrations: { expected: '0004_admin_persistence', current: '0004_admin_persistence' }
  });
  assert.equal(result.primary, 'ACCOUNT_API_UNREADY');
  assert.equal(result.findings[0].evidence[0].source, 'health.services.account-api');
});

test('one-shot incident bundle is healthy-fixture compatible and contains no exact synthetic secret bytes', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 'oldko ws29 bundle '));
  const composeRows = JSON.stringify([
    { Service: 'account-api', Name: 'oldko-account', State: 'running', Health: 'healthy', Status: 'Up', Publishers: [{ PublishedPort: 443 }] },
    { Service: 'postgres', Name: 'oldko-postgres', State: 'running', Health: 'healthy', Status: 'Up' }
  ]);
  const executor = (command, args) => {
    if (args[0] === 'compose' && args.includes('ps')) return { status: 0, stdout: `${composeRows}\n`, stderr: '' };
    if (args[0] === 'inspect') return { status: 0, stdout: '{"Status":"running","Health":{"Status":"healthy"}}|0\n', stderr: '' };
    if (args[0] === 'compose' && args.includes('logs')) {
      const log = [
        `Authorization: ${secrets.auth}`,
        `Cookie: ${secrets.cookie}`,
        `POST /verify?verification_token=${secrets.verify}`,
        `password=${secrets.password}`,
        `csrf_value=${secrets.csrf}`,
        `DATABASE_URL=postgres://oldko:${secrets.dbpass}@db:5432/oldko`,
        `delivery_webhook_secret=${secrets.webhook}`,
        `tunnel_token=${secrets.tunnel}`,
        `admin_session_secret=${secrets.admin}`
      ].join('\n');
      return { status: 0, stdout: log, stderr: '' };
    }
    if (args[0] === 'compose' && args.includes('exec')) return { status: 0, stdout: '', stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"status":"ok"}' });
  const forbidden = [secrets.password, secrets.cookie, secrets.csrf, secrets.verify, secrets.reset, secrets.webhook, secrets.dbpass, secrets.tunnel, secrets.admin, 'eyJhbGciOiJub25l.TEST.SIGN'];
  const result = await createIncidentBundle({
    out_dir: out,
    bundle_id: 'fixture\\windows/path',
    release: { release_id: 'oldkoweb-domain-live-20261015', provider_set: 'WS50-final@sha256:fixture', client_artifact: 'artifact-1', service_version: 'svc@sha256:1', migration_head: '0004_admin_persistence' },
    collector: { services: ['account-api', 'postgres'], postgres_service: 'postgres', endpoints: [{ name: 'account-api', url: 'http://127.0.0.1/health' }], migration: { current: '0004_admin_persistence', expected: '0004_admin_persistence' } },
    browser_evidence: { run_id: '38651943750', provider_set: 'WS50-final@sha256:fixture', entity_runtime_id: 'mob-800-1', asset_id: 'mob_bandicoot.n3chr', frame_evidence_path: 'artifacts/ws05/frame.png' },
    synthetic_forbidden_values: forbidden
  }, { executor, fetchImpl });

  assert.equal(result.summary.release_id, 'oldkoweb-domain-live-20261015');
  assert.equal(result.summary.classification.primary, 'UNKNOWN');
  assert.equal(path.basename(result.bundle_dir).includes('\\'), false);
  assert.equal(path.basename(result.bundle_dir).includes('/'), false);
  const top = await readdir(result.bundle_dir);
  for (const required of ['summary.json', 'release.json', 'health.json', 'migrations.json', 'containers.json', 'known-error-signatures.json', 'browser-evidence.json', 'logs']) assert.ok(top.includes(required), required);
  const log = await readFile(path.join(result.bundle_dir, 'logs', 'account-api.log'), 'utf8');
  for (const secret of forbidden) assert.equal(log.includes(secret), false, secret);
  const health = JSON.parse(await readFile(path.join(result.bundle_dir, 'health.json'), 'utf8'));
  assert.equal(health.postgres.connectivity, true);
  const containers = JSON.parse(await readFile(path.join(result.bundle_dir, 'containers.json'), 'utf8'));
  assert.equal(containers[0].restart_count, 0);
});
