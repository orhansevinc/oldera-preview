import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = process.env.OFFICIAL_ACCOUNT_JS;
const contractTest = sourcePath ? test : test.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

contractTest('official account-v15.js matches the WS13 public route contract', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.match(source, /accountApiBase\|\|'\/api\/account'/);
  const routes = [
    '/v1/accounts/register',
    '/v1/accounts/verification/request',
    '/v1/accounts/verification/confirm',
    '/v1/session/login',
    '/v1/session/current',
    '/v1/session/logout',
    '/v1/accounts/password/change',
    '/v1/accounts/password-reset/request',
    '/v1/accounts/password-reset/confirm'
  ];
  for (const route of routes) assert.ok(source.includes(`api('${route}`), `missing frontend route ${route}`);
  for (const route of routes) assert.ok(`/api/account${route}`.startsWith('/api/account/v1/'));
  assert.equal(source.includes('localStorage'), false);
  assert.equal(source.includes('sessionStorage'), false);
});

test('frontend owner has a machine-readable KO1298 credential contract', async () => {
  const contractPath = path.resolve(here, '../../services/account-api/contracts/credential-policy.v1.json');
  const contract = JSON.parse(await fs.readFile(contractPath, 'utf8'));
  assert.equal(contract.contract_version, 'oldko.credentials.v1');
  assert.equal(contract.username.max_bytes, 20);
  assert.equal(contract.username.trim_input, false);
  assert.equal(contract.password_write.min_bytes, 10);
  assert.equal(contract.password_write.max_bytes, 12);
  assert.equal(contract.password_write.encoding, 'ASCII');
  assert.equal(contract.password_write.trim_input, false);
  assert.equal(contract.password_write.unicode_normalization, 'none');
  assert.equal(contract.password_write.silent_truncation, false);
  assert.equal(contract.legacy_transition.web_login_response_field, 'credentialUpgradeRequired');
});
