const fs = require('node:fs');
const path = require('node:path');
const core = require('../../play-shell/launcher-core.js');

const configPath = path.resolve(__dirname, '../../play-shell/config.json');
const config = core.normalizeConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
const forbiddenSchemes = [/^javascript:/i, /^data:/i];
const urls = [config.client.entryUrl, config.client.buildUrl, ...config.client.requiredFiles];
for (const url of urls) {
  if (forbiddenSchemes.some((pattern) => pattern.test(url))) throw new Error(`Unsafe URL in config: ${url}`);
}
if (!/^ws12-|^[0-9a-z._-]+$/i.test(config.cacheVersion)) throw new Error('cacheVersion invalid');
console.log(`WS12 config OK: ${config.brand.product}/${config.brand.game} patch ${config.brand.patch}; ${urls.length} package URLs`);
