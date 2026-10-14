#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const providerRoot = path.resolve(process.argv[2] || path.join(repoRoot, '.ws49-c5-providers'));
const WS50_SOURCE_COMMIT = '0d5001095fa3b43693b4fa0cda615f84e2cb7df5';
const EXPECTED_KEY = 'WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e';

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: options.encoding ?? 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: 128 * 1024 * 1024,
    input: options.input,
  });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
function canonicalHash(document) {
  const copy = structuredClone(document);
  delete copy.content_hash;
  delete copy.immutable_key;
  const encoded = JSON.stringify(canonical(copy));
  return `sha256:${createHash('sha256').update(encoded, 'utf8').digest('hex')}`;
}
function requireCommit(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    git(['fetch', '--no-tags', 'origin', sha], { stdio: 'inherit' });
    git(['cat-file', '-e', `${sha}^{commit}`]);
  }
}

requireCommit(WS50_SOURCE_COMMIT);
const manifestText = git(['show', `${WS50_SOURCE_COMMIT}:release/sets/ws50/C5.json`]);
const manifest = JSON.parse(manifestText);
if (manifest.immutable_key !== EXPECTED_KEY) throw new Error(`unexpected provider set ${manifest.immutable_key}`);
if (manifest.content_hash !== canonicalHash(manifest)) throw new Error('C5 canonical content hash mismatch');
if (manifest.candidate_result !== 'PASS') throw new Error('C5 is not composition PASS');
if (manifest.readiness?.COMPOSITION_READY !== 'READY' || manifest.readiness?.BROWSER_READY !== 'NEEDS_WS10') {
  throw new Error('C5 readiness contract mismatch');
}

const pathsByProvider = {
  WS03: ['services/ko1298-session', 'tests/ko1298-session'],
  WS11: ['protocol-lab/PROTOCOL_OWNER_MATRIX.json', 'protocol-lab/VISIBILITY_PROTOCOL_PROFILE.json', 'protocol-lab/visibility-fixtures', 'tools/ws11_protocol'],
  WS14: ['services/ko1298-world', 'tests/ko1298-world'],
  WS15: ['services/ko1298-movement', 'tests/ko1298-movement'],
  WS16: ['services/ko1298-npc', 'tests/ko1298-npc', 'world-data/npc'],
  WS25: ['services/ko1298-mobs', 'tests/ko1298-mobs', 'world-data/mobs'],
  WS31: ['data-catalog/generated/catalog-summary.json', 'data-catalog/npcs.json'],
  WS45: ['services/session-ownership', 'tests/session-ownership'],
};

await rm(providerRoot, { recursive: true, force: true });
await mkdir(providerRoot, { recursive: true });
const staged = [];
for (const provider of manifest.providers) {
  const paths = pathsByProvider[provider.ws];
  if (!paths) continue;
  requireCommit(provider.exact_sha);
  const archive = git(['archive', '--format=tar', provider.exact_sha, '--', ...paths], { encoding: null });
  execFileSync('tar', ['-xf', '-', '-C', providerRoot], {
    cwd: repoRoot,
    input: archive,
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 128 * 1024 * 1024,
  });
  staged.push({ ws: provider.ws, branch: provider.branch, exact_sha: provider.exact_sha, paths });
}

await writeFile(path.join(providerRoot, 'ws50-provider-set.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const receipt = {
  schema_version: 'ws49-immutable-provider-stage/v1',
  provider_set: manifest.immutable_key,
  manifest_source_commit: WS50_SOURCE_COMMIT,
  branch_head_resolution: false,
  staged,
};
await writeFile(path.join(providerRoot, 'ws49-provider-stage.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`WS49_IMMUTABLE_PROVIDER_SET ${manifest.immutable_key}`);
console.log(`WS49_PROVIDER_STAGE_COUNT ${staged.length}`);
