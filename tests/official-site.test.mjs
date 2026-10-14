import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(name)=>fs.readFileSync(new URL(`../${name}`,import.meta.url),'utf8');

test('production links use canonical domains and no preview paths',()=>{
  const home=read('index.html'), account=read('account.html');
  for(const text of [home,account]) assert.equal(text.includes('/oldera-preview/'),false);
  assert.match(home,/https:\/\/play\.oldkoweb\.com\//);
  assert.match(account,/https:\/\/play\.oldkoweb\.com\//);
  assert.match(home,/href="\/account\.html#login"/);
});

test('opening date is configurable rather than hard-coded promise',()=>{
  const home=read('index.html'), config=read('site-config.js'), js=read('oldkoweb-v14.js');
  assert.equal(home.includes('01.11.2026'),false);
  assert.match(config,/openingAt:\s*null/);
  assert.match(config,/showCountdown:\s*false/);
  assert.match(js,/config\.openingAt/);
});

test('account dashboard requires server current-user session',()=>{
  const js=read('account-v15.js');
  assert.match(js,/\/v1\/session\/current/);
  assert.match(js,/\/v1\/session\/login/);
  assert.match(js,/\/v1\/session\/logout/);
  assert.equal(js.includes("if(id==='dashboard'){showPortal()"),false);
});

test('real public service routes are wired without fake counters',()=>{
  const js=read('oldkoweb-v14.js');
  assert.match(js,/\/v1\/rankings\/levels/);
  assert.match(js,/\/v1\/rankings\/national-points/);
  assert.match(js,/\/v1\/rankings\/clans/);
  assert.match(js,/\/v1\/realms/);
  assert.equal(/Math\.random/.test(js),false);
});
