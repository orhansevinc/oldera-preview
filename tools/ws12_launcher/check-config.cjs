const fs = require('node:fs');
const path = require('node:path');
const core = require('../../play-shell/launcher-core.js');
const releases = require('../../play-shell/release-channel.js');

const root = path.resolve(__dirname, '../..');
const forbidden = /trycloudflare|^javascript:|^data:/i;

function readRaw(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of ['play-shell/config.json', 'play-shell/config.staging.example.json']) {
  const raw = readRaw(relativePath);
  const config = core.normalizeConfig(raw);
  const release = releases.normalizeReleaseConfig(raw.release);
  if (!config.publication.enabled || config.publication.latestUrl !== '/releases/preview/latest.json') throw new Error(`${relativePath}: preview latest pointer required`);
  if (!config.publication.requirePublicationMarker || !config.publication.verifyRequiredFiles || !config.publication.strictContentType) throw new Error(`${relativePath}: publication checks must fail closed`);
  if (release.channel !== 'preview' || release.latestUrl !== '/releases/preview/latest.json') throw new Error(`${relativePath}: preview release channel invalid`);
  if (release.canonicalUrl !== 'https://play.oldkoweb.com/' || release.canonicalHost !== 'play.oldkoweb.com') throw new Error(`${relativePath}: canonical play URL invalid`);
  if (config.mobile.policy !== 'block') throw new Error(`${relativePath}: unsupported mobile gameplay must be blocked`);
  if (config.gateway.endpoints.length !== 0 || !config.gateway.required) throw new Error(`${relativePath}: gateway endpoints must come from accepted release pointer`);
  if (forbidden.test(JSON.stringify(raw))) throw new Error(`${relativePath}: forbidden tunnel/unsafe URL found`);
}

console.log('WS12 config OK: canonical play.oldkoweb.com + preview immutable release pointer');
