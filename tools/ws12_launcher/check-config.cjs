const fs = require('node:fs');
const path = require('node:path');
const core = require('../../play-shell/launcher-core.js');

const root = path.resolve(__dirname, '../..');
const forbiddenSchemes = [/^javascript:/i, /^data:/i];

function readConfig(relativePath) {
  const fullPath = path.join(root, relativePath);
  return core.normalizeConfig(JSON.parse(fs.readFileSync(fullPath, 'utf8')));
}

function validateUrls(config, label) {
  const urls = [];
  if (config.client.entryUrl) urls.push(config.client.entryUrl, config.client.buildUrl, ...config.client.requiredFiles);
  if (config.publication.latestUrl) urls.push(config.publication.latestUrl);
  for (const endpoint of config.gateway.endpoints) urls.push(endpoint.url);
  for (const url of urls) {
    if (forbiddenSchemes.some((pattern) => pattern.test(url))) throw new Error(`${label}: unsafe URL: ${url}`);
  }
}

const local = readConfig('play-shell/config.json');
validateUrls(local, 'local');
if (!/^ws12-|^[0-9a-z._-]+$/i.test(local.cacheVersion)) throw new Error('local cacheVersion invalid');
if (local.publication.enabled) throw new Error('local config must stay runnable without a published WS38 pointer');

const staging = readConfig('play-shell/config.staging.example.json');
validateUrls(staging, 'staging');
if (!staging.publication.enabled) throw new Error('staging publication.latestUrl required');
if (!staging.publication.requirePublicationMarker || !staging.publication.verifyRequiredFiles || !staging.publication.strictContentType) {
  throw new Error('staging WS38 checks must fail closed');
}
const endpointNames = staging.gateway.endpoints.map((item) => item.name).sort();
if (endpointNames.join(',') !== 'auth,game' || !staging.gateway.required) throw new Error('staging auth/game gateway contract invalid');
if (!staging.gateway.endpoints.every((item) => item.url === `/${item.name}`)) throw new Error('staging gateway paths must be same-origin /auth and /game');

console.log(`WS12 config OK: local legacy package + staging WS38 publication; gateways=${endpointNames.join('+')}`);
