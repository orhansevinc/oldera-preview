#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectDiagnostics } from '../src/collector.js';
import { createIncidentBundle } from '../src/incident-bundle.js';

function flags(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (!args[i].startsWith('--')) continue;
    const key = args[i].slice(2).replace(/-/g, '_');
    const next = args[i + 1];
    result[key] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return result;
}

async function loadConfig(file) {
  if (!file) return {};
  return JSON.parse(await readFile(path.resolve(file), 'utf8'));
}

async function main() {
  const [group, action, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const config = await loadConfig(f.config);

  if (group === 'incident' && action === 'bundle') {
    const result = await createIncidentBundle({ ...config, ...(f.out ? { out_dir: f.out } : {}) });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (group === 'health' && action === 'collect') {
    const result = await collectDiagnostics(config.collector ?? config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stderr.write('Usage:\n  oldko-diagnostics incident bundle --config <file> [--out <dir>]\n  oldko-diagnostics health collect --config <file>\n');
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
