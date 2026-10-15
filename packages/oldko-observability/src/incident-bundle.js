import { mkdir, writeFile, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { collectDiagnostics } from './collector.js';
import { classifyIncident, KNOWN_ERROR_SIGNATURES } from './classification.js';
import { loadReleaseIdentity } from './identity.js';
import { redact, sanitizeText, containsForbiddenBytes } from './redaction.js';

const SAFE_BASENAME = /[^A-Za-z0-9._-]/g;

function isoStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(redact(value), null, 2)}\n`, 'utf8');
}

function normalizeBrowserEvidence(input = {}) {
  return redact({
    schema_version: 'oldkoweb-browser-evidence-ref/v1',
    run_id: input.run_id ?? null,
    provider_set: input.provider_set ?? null,
    entity_runtime_id: input.entity_runtime_id ?? null,
    asset_id: input.asset_id ?? null,
    frame_evidence_path: input.frame_evidence_path ?? null,
    entity_created: input.entity_created,
    model_loaded: input.model_loaded,
    asset_missing: input.asset_missing,
    websocket_disconnected: input.websocket_disconnected
  });
}

async function scanForbidden(root, forbiddenValues) {
  const leaks = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        const content = await readFile(full);
        if (containsForbiddenBytes(content, forbiddenValues)) leaks.push(full);
      }
    }
  }
  await walk(root);
  return leaks;
}

export async function pruneIncidentBundles(root, retention = {}) {
  const maxBundles = retention.max_bundles ?? 10;
  const maxAgeDays = retention.max_age_days ?? 7;
  const prefix = retention.prefix ?? 'oldkoweb-incident-';
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const full = path.join(root, entry.name);
    const s = await stat(full);
    candidates.push({ full, mtimeMs: s.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const removed = [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (i >= maxBundles || candidates[i].mtimeMs < cutoff) {
      await rm(candidates[i].full, { recursive: true, force: true });
      removed.push(candidates[i].full);
    }
  }
  return removed;
}

export async function createIncidentBundle(config = {}, deps = {}) {
  const outRoot = path.resolve(config.out_dir ?? process.cwd());
  await mkdir(outRoot, { recursive: true });
  await pruneIncidentBundles(outRoot, config.retention);

  const suffix = String(config.bundle_id ?? isoStamp()).replace(SAFE_BASENAME, '_');
  const bundleDir = path.join(outRoot, `oldkoweb-incident-${suffix}`);
  const logsDir = path.join(bundleDir, 'logs');
  await mkdir(logsDir, { recursive: true });

  const release = await loadReleaseIdentity(config.release ?? {});
  const collected = await collectDiagnostics(config.collector ?? {}, deps);
  const browserEvidence = normalizeBrowserEvidence(config.browser_evidence ?? {});
  const classification = classifyIncident({
    health: collected.health,
    migrations: collected.migrations,
    logs: collected.logs,
    browser_evidence: browserEvidence
  });

  for (const [service, text] of Object.entries(collected.logs)) {
    const name = String(service).replace(SAFE_BASENAME, '_') || 'unknown-service';
    await writeFile(path.join(logsDir, `${name}.log`), `${sanitizeText(text, { maxStringLength: config.max_log_chars ?? 200000 })}\n`, 'utf8');
  }

  const summary = {
    schema_version: 'oldkoweb-incident-bundle/v1',
    created_at: new Date().toISOString(),
    release_id: release.release_id,
    provider_set: release.provider_set ?? null,
    classification,
    bundle_files: ['summary.json', 'release.json', 'health.json', 'migrations.json', 'containers.json', 'known-error-signatures.json', 'browser-evidence.json', 'logs/'],
    exclusions: ['database dumps', 'passwords', 'session cookies', 'private keys', 'raw tokens']
  };

  await writeJson(path.join(bundleDir, 'summary.json'), summary);
  await writeJson(path.join(bundleDir, 'release.json'), release);
  await writeJson(path.join(bundleDir, 'health.json'), { ...collected.health, gateway_ports: collected.gateway_ports, collector_errors: collected.collector_errors });
  await writeJson(path.join(bundleDir, 'migrations.json'), collected.migrations);
  await writeJson(path.join(bundleDir, 'containers.json'), collected.containers);
  await writeJson(path.join(bundleDir, 'known-error-signatures.json'), { signatures: KNOWN_ERROR_SIGNATURES });
  await writeJson(path.join(bundleDir, 'browser-evidence.json'), browserEvidence);

  const forbiddenValues = (config.synthetic_forbidden_values ?? []).filter((x) => x !== undefined && x !== null && String(x).length > 0);
  const leaks = await scanForbidden(bundleDir, forbiddenValues);
  if (leaks.length) {
    await rm(bundleDir, { recursive: true, force: true });
    throw new Error(`SECRET_LEAK_DETECTED:${leaks.map((p) => path.basename(p)).join(',')}`);
  }

  return { bundle_dir: bundleDir, summary };
}
