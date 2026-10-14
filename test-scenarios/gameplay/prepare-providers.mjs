#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const manifestPath = path.join(here, 'provider-manifest.json');
const providerRoot = path.resolve(process.argv[2] || path.join(repoRoot, '.ws49-providers'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const pathsByProvider = {
  WS03: ['workstreams/ws03/STATUS.md', 'services/ko1298-session', 'tests/ko1298-session'],
  WS10: ['workstreams/ws10/STATUS.md'],
  WS14: ['workstreams/ws14/STATUS.md', 'services/ko1298-world', 'tests/ko1298-world'],
  WS15: ['workstreams/ws15/STATUS.md', 'services/ko1298-movement', 'tests/ko1298-movement'],
  WS16: ['workstreams/ws16/STATUS.md'],
  WS17: ['workstreams/ws17/STATUS.md'],
  WS19: ['workstreams/ws19/STATUS.md'],
  WS22: ['workstreams/ws22/STATUS.md', 'services/ko1298-economy', 'tests/ko1298-economy'],
  WS25: ['workstreams/ws25/STATUS.md'],
  WS26: ['workstreams/ws26/STATUS.md', 'services/ko1298-loot'],
  WS27: ['workstreams/ws27/STATUS.md', 'services/ko1298-progression', 'tests/ko1298-progression'],
  WS31: ['workstreams/ws31/STATUS.md']
};

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim();
}

function commitExists(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function stageProvider(provider) {
  git(['fetch', '--no-tags', 'origin', `refs/heads/${provider.branch}:refs/remotes/origin/${provider.branch}`]);
  const actualSha = git(['rev-parse', `refs/remotes/origin/${provider.branch}`]);
  if (!commitExists(provider.sha)) {
    git(['fetch', '--no-tags', 'origin', provider.sha]);
  }
  if (!commitExists(provider.sha)) {
    throw new Error(`${provider.id}: pinned commit is unavailable: ${provider.sha}`);
  }

  const destination = path.join(providerRoot, provider.slug);
  await mkdir(destination, { recursive: true });
  const paths = pathsByProvider[provider.id];
  if (!paths?.length) throw new Error(`${provider.id}: no staged paths configured`);

  const archive = execFileSync('git', ['archive', '--format=tar', provider.sha, '--', ...paths], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024
  });
  execFileSync('tar', ['-xf', '-', '-C', destination], {
    cwd: repoRoot,
    input: archive,
    stdio: ['pipe', 'inherit', 'inherit'],
    maxBuffer: 64 * 1024 * 1024
  });

  return {
    id: provider.id,
    slug: provider.slug,
    branch: provider.branch,
    pinnedSha: provider.sha,
    actualHeadSha: actualSha,
    drift: actualSha !== provider.sha,
    stagedPaths: paths
  };
}

await rm(providerRoot, { recursive: true, force: true });
await mkdir(providerRoot, { recursive: true });
const resolved = [];
for (const provider of manifest.providers) resolved.push(await stageProvider(provider));

const runtimeManifest = {
  schemaVersion: 1,
  repository: manifest.repository,
  capturedAt: manifest.capturedAt,
  generatedAt: new Date().toISOString(),
  providers: resolved
};
await writeFile(path.join(providerRoot, 'actual-provider-heads.json'), `${JSON.stringify(runtimeManifest, null, 2)}\n`);

for (const provider of resolved) {
  const drift = provider.drift ? ' DRIFT' : '';
  console.log(`${provider.id} ${provider.branch} ${provider.actualHeadSha}${drift}`);
}
