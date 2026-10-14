'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

function fail(message) {
  const error = new Error(message);
  error.code = 'WS10_PROVIDER_SET_LOCK_FAILED';
  throw error;
}

function computeContentHash(document) {
  const copy = structuredClone(document);
  delete copy.content_hash;
  delete copy.immutable_key;
  const canonical = JSON.stringify(copy, Object.keys(copy).sort());
  // JSON.stringify replacer arrays only sort the root, so use a recursive canonicalizer.
  const canonicalize = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  void canonical;
  return `sha256:${crypto.createHash('sha256').update(canonicalize(copy)).digest('hex')}`;
}

function lockProviderSet(document, expectedImmutableKey) {
  if (!document || typeof document !== 'object') fail('provider-set manifest must be a JSON object');
  if (!expectedImmutableKey || typeof expectedImmutableKey !== 'string') fail('expected immutable provider-set ID is required');
  if (document.immutable_key !== expectedImmutableKey) {
    fail(`immutable provider-set mismatch expected=${expectedImmutableKey} actual=${document.immutable_key || '(missing)'}`);
  }
  const actualHash = computeContentHash(document);
  if (document.content_hash !== actualHash) {
    fail(`provider-set content hash mismatch expected=${document.content_hash || '(missing)'} actual=${actualHash}`);
  }
  if (!Array.isArray(document.providers) || document.providers.length === 0) fail('provider-set has no providers');

  const providers = {};
  for (const provider of document.providers) {
    if (!provider || typeof provider.ws !== 'string' || !/^[A-Z0-9_-]+$/.test(provider.ws)) fail('invalid provider ws key');
    if (typeof provider.exact_sha !== 'string' || !/^[0-9a-f]{40}$/i.test(provider.exact_sha)) fail(`invalid exact SHA for ${provider.ws}`);
    if (providers[provider.ws]) fail(`duplicate provider ${provider.ws}`);
    providers[provider.ws] = provider.exact_sha.toLowerCase();
  }

  return {
    schema: 'oldkoweb.ws10.provider-set-lock.v1',
    immutableKey: expectedImmutableKey,
    contentHash: actualHash,
    candidateResult: document.candidate_result ?? null,
    providers,
  };
}

if (require.main === module) {
  const [manifestPath, expectedImmutableKey, outputPath] = process.argv.slice(2);
  if (!manifestPath || !expectedImmutableKey) {
    console.error('usage: node lock-provider-set.cjs <manifest.json> <immutable-key> [output.json]');
    process.exit(64);
  }
  try {
    const document = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const locked = lockProviderSet(document, expectedImmutableKey);
    const encoded = `${JSON.stringify(locked, null, 2)}\n`;
    if (outputPath) fs.writeFileSync(outputPath, encoded);
    else process.stdout.write(encoded);
    console.error(`WS10_PROVIDER_SET_LOCK PASS immutable=${locked.immutableKey} providers=${Object.keys(locked.providers).length}`);
  } catch (error) {
    console.error(`WS10_PROVIDER_SET_LOCK FAIL ${error.message}`);
    process.exit(1);
  }
}

module.exports = { computeContentHash, lockProviderSet };
