import { spawnSync } from 'node:child_process';
import { statfs, readFile } from 'node:fs/promises';
import { redact, sanitizeText } from './redaction.js';

function defaultExecutor(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message };
}

function composeArgs(config, tail) {
  const args = ['compose'];
  if (config.compose_file) args.push('-f', config.compose_file);
  if (config.project_name) args.push('-p', config.project_name);
  return args.concat(tail);
}

function parseJsonLines(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Docker versions differ; non-JSON output is retained only as sanitized diagnostic text elsewhere.
    }
  }
  return out;
}

async function fetchEndpoint(endpoint, fetchImpl) {
  const started = Date.now();
  try {
    const response = await fetchImpl(endpoint.url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(endpoint.timeout_ms ?? 4000) });
    let body = '';
    try { body = await response.text(); } catch {}
    return {
      name: endpoint.name,
      url: endpoint.url,
      status_code: response.status,
      ready: response.ok,
      latency_ms: Date.now() - started,
      body: sanitizeText(body, { maxStringLength: 2048 })
    };
  } catch (error) {
    return { name: endpoint.name, url: endpoint.url, ready: false, latency_ms: Date.now() - started, error: sanitizeText(error?.message ?? String(error)) };
  }
}

async function diskInfo(path) {
  try {
    const s = await statfs(path);
    return { path, bytes_free: Number(s.bavail) * Number(s.bsize), bytes_total: Number(s.blocks) * Number(s.bsize) };
  } catch (error) {
    return { path, error: sanitizeText(error?.message ?? String(error)) };
  }
}

export async function collectDiagnostics(config = {}, deps = {}) {
  const executor = deps.executor ?? defaultExecutor;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const docker = { available: false, compose_ps: [], raw_errors: [] };
  const logs = {};
  const containers = [];

  const ps = executor(config.docker_command ?? 'docker', composeArgs(config, ['ps', '--format', 'json']));
  docker.available = ps.status === 0;
  docker.compose_ps = parseJsonLines(ps.stdout);
  if (ps.status !== 0) docker.raw_errors.push(sanitizeText(ps.stderr || ps.error || 'docker compose ps failed'));

  for (const row of docker.compose_ps) {
    const name = row.Name ?? row.name;
    let restartCount = null;
    let inspectedHealth;
    let inspectedState;
    if (name) {
      const inspected = executor(config.docker_command ?? 'docker', ['inspect', '--format', '{{json .State}}|{{.RestartCount}}', name]);
      if (inspected.status === 0) {
        const marker = String(inspected.stdout).lastIndexOf('|');
        if (marker >= 0) {
          try {
            const state = JSON.parse(String(inspected.stdout).slice(0, marker));
            inspectedState = state.Status;
            inspectedHealth = state.Health?.Status;
          } catch {}
          const parsedRestart = Number.parseInt(String(inspected.stdout).slice(marker + 1).trim(), 10);
          if (Number.isFinite(parsedRestart)) restartCount = parsedRestart;
        }
      }
    }
    containers.push(redact({
      service: row.Service ?? row.service,
      name,
      state: inspectedState ?? row.State ?? row.state,
      health: inspectedHealth ?? row.Health ?? row.health,
      restart_count: restartCount,
      status: row.Status ?? row.status,
      ports: row.Publishers ?? row.Ports ?? row.ports
    }));
  }

  const services = config.services?.length ? config.services : [...new Set(containers.map((c) => c.service).filter(Boolean))];
  for (const service of services) {
    const result = executor(config.docker_command ?? 'docker', composeArgs(config, ['logs', '--no-color', '--since', config.logs_since ?? '15m', '--tail', String(config.logs_tail ?? 500), service]));
    logs[service] = sanitizeText(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`, { maxStringLength: config.max_log_chars ?? 200000 });
  }

  let postgres = { connectivity: null, service: config.postgres_service ?? null };
  if (config.postgres_service) {
    const pg = executor(config.docker_command ?? 'docker', composeArgs(config, ['exec', '-T', config.postgres_service, 'pg_isready', '-q']));
    postgres = { connectivity: pg.status === 0, service: config.postgres_service, ...(pg.status === 0 ? {} : { error: sanitizeText(pg.stderr || pg.error || 'pg_isready failed') }) };
  }

  const endpoints = [];
  for (const endpoint of config.endpoints ?? []) endpoints.push(await fetchEndpoint(endpoint, fetchImpl));

  let migrations = { current: config.migration?.current ?? null, expected: config.migration?.expected ?? null };
  if (config.migration?.file) {
    try {
      const raw = JSON.parse(await readFile(config.migration.file, 'utf8'));
      migrations = { ...migrations, ...redact(raw) };
    } catch (error) {
      migrations.error = sanitizeText(error?.message ?? String(error));
    }
  }

  return {
    collected_at: new Date().toISOString(),
    health: {
      docker_available: docker.available,
      postgres,
      services: endpoints,
      disk: await diskInfo(config.disk_path ?? process.cwd())
    },
    migrations,
    containers,
    logs,
    gateway_ports: containers.map(({ service, ports }) => ({ service, ports })).filter((x) => x.ports),
    collector_errors: docker.raw_errors
  };
}
