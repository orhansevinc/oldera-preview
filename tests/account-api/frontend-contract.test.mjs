import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const sourcePath = process.env.OFFICIAL_ACCOUNT_JS;
const contractTest = sourcePath ? test : test.skip;

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
