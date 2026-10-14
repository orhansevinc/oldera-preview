#!/usr/bin/env node
import dns from 'node:dns/promises';
import tls from 'node:tls';
import fs from 'node:fs/promises';
import path from 'node:path';

const RELEASE_ID = process.env.OLDKO_RELEASE_ID || 'oldkoweb-domain-live-20261015';
const OUT = process.env.OLDKO_QA_RESULT || 'artifacts/domain-live/live-http.json';
const timeoutMs = Number(process.env.OLDKO_HTTP_TIMEOUT_MS || 15000);

const urls = {
  website: 'https://oldkoweb.com/',
  login: 'https://oldkoweb.com/account.html#login',
  register: 'https://oldkoweb.com/account.html#register',
  dashboard: 'https://oldkoweb.com/account.html#dashboard',
  accountCurrent: 'https://oldkoweb.com/api/account/v1/session/current',
  play: 'https://play.oldkoweb.com/',
  admin: 'https://admin.oldkoweb.com/',
  adminApi: 'https://admin.oldkoweb.com/api/admin/'
};

const result = {
  schema_version: 'ws10-domain-live-http/v1',
  release_id: RELEASE_ID,
  generated_at: new Date().toISOString(),
  gate: 'B_PUBLIC_DOMAIN_TRANSPORT_AND_SURFACE',
  domains: {},
  checks: [],
  discovered_assets: [],
  mandatory_user_flows: {
    real_account_delivery_and_verification: 'NOT_RUN',
    password_change_and_reset: 'NOT_RUN',
    same_password_game_login: 'NOT_RUN',
    real_cpp_wasm_webgl2_gameplay: 'NOT_RUN',
    real_admin_persistent_mutation: 'NOT_RUN',
    restart_persistence: 'NOT_RUN',
    rollback_live: 'NOT_RUN'
  },
  blockers: [],
  status: 'BLOCKED'
};

function addCheck(id, status, evidence = {}) {
  result.checks.push({ id, status, evidence });
  return status;
}

async function resolveHost(host) {
  try {
    const records = await dns.resolveAny(host);
    result.domains[host] = { ...(result.domains[host] || {}), dns: records };
    addCheck(`dns:${host}`, records.length ? 'PASS' : 'FAIL', { records });
    return records.length > 0;
  } catch (error) {
    result.domains[host] = { ...(result.domains[host] || {}), dns_error: String(error?.message || error) };
    addCheck(`dns:${host}`, 'BLOCKED', { error: String(error?.message || error) });
    result.blockers.push({ owner: 'WS09', code: 'PUBLIC_DNS_UNRESOLVED', host, detail: String(error?.message || error) });
    return false;
  }
}

async function tlsProbe(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate();
      const info = { authorized: socket.authorized, protocol: socket.getProtocol(), valid_from: cert.valid_from, valid_to: cert.valid_to, subject: cert.subject, issuer: cert.issuer };
      result.domains[host] = { ...(result.domains[host] || {}), tls: info };
      addCheck(`tls:${host}`, socket.authorized ? 'PASS' : 'FAIL', info);
      socket.end();
      resolve(socket.authorized);
    });
    const fail = (error) => {
      const message = String(error?.message || error);
      result.domains[host] = { ...(result.domains[host] || {}), tls_error: message };
      addCheck(`tls:${host}`, 'BLOCKED', { error: message });
      result.blockers.push({ owner: 'WS09', code: 'TLS_UNAVAILABLE', host, detail: message });
      socket.destroy();
      resolve(false);
    };
    socket.once('timeout', () => fail(new Error('TLS timeout')));
    socket.once('error', fail);
  });
}

async function httpGet(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: options.headers || {} });
    const array = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(array.slice(0, 2_000_000));
    return {
      ok: true,
      status: response.status,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type') || '',
      contentLength: response.headers.get('content-length'),
      acceptRanges: response.headers.get('accept-ranges'),
      body: text
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function normalize(url) {
  return url.split('#')[0];
}

function extractAssets(html, base) {
  const found = new Set();
  for (const re of [/\b(?:src|href)=["']([^"']+)["']/gi, /url\(["']?([^)'"\s]+)["']?\)/gi]) {
    let m;
    while ((m = re.exec(html))) {
      const raw = m[1].trim();
      if (!raw || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('mailto:') || raw.startsWith('javascript:')) continue;
      try { found.add(new URL(raw, base).href); } catch {}
    }
  }
  return [...found];
}

function isHtmlFallback(r) {
  return /text\/html/i.test(r.contentType || '') || /^\s*<!doctype html/i.test(r.body || '') || /^\s*<html/i.test(r.body || '');
}

async function checkPage(id, url, predicates = []) {
  const r = await httpGet(normalize(url));
  if (!r.ok) {
    addCheck(id, 'BLOCKED', { url, error: r.error });
    return { ...r, statusClass: 'BLOCKED' };
  }
  const predFailures = predicates.filter((p) => !p.test(r.body || '')).map((p) => String(p));
  const status = r.status === 200 && !predFailures.length ? 'PASS' : 'FAIL';
  addCheck(id, status, { url, http_status: r.status, content_type: r.contentType, predicate_failures: predFailures });
  return { ...r, statusClass: status };
}

const hosts = ['oldkoweb.com', 'play.oldkoweb.com', 'admin.oldkoweb.com'];
const dnsOk = {};
for (const h of hosts) dnsOk[h] = await resolveHost(h);
for (const h of hosts) if (dnsOk[h]) await tlsProbe(h);

const home = await checkPage('website:homepage', urls.website, [/OldKOWeb/i, /1299 CLASSIC/i, /play\.oldkoweb\.com/i]);
if (home.ok) {
  const comingSoon = /coming\s+soon/i.test(home.body || '');
  addCheck('website:not-coming-soon', comingSoon ? 'FAIL' : 'PASS', { matched: comingSoon });
  const mixed = [...(home.body || '').matchAll(/\bhttp:\/\/[^\s"'<>]+/gi)].map((m) => m[0]);
  addCheck('website:no-mixed-content-markup', mixed.length ? 'FAIL' : 'PASS', { http_urls: mixed.slice(0, 20) });

  const assets = extractAssets(home.body || '', urls.website).filter((u) => new URL(u).origin === new URL(urls.website).origin);
  for (const asset of assets.slice(0, 40)) {
    const r = await httpGet(asset);
    const status = r.ok && r.status >= 200 && r.status < 400 ? 'PASS' : (r.ok ? 'FAIL' : 'BLOCKED');
    result.discovered_assets.push({ url: asset, status, http_status: r.status ?? null, content_type: r.contentType ?? null, error: r.error ?? null });
  }
  addCheck('website:assets', result.discovered_assets.some((x) => x.status !== 'PASS') ? 'FAIL' : 'PASS', { count: result.discovered_assets.length, failures: result.discovered_assets.filter((x) => x.status !== 'PASS') });
}

for (const [id, u] of [['login', urls.login], ['register', urls.register], ['dashboard', urls.dashboard]]) {
  await checkPage(`website:deep-link:${id}`, u, [/OldKOWeb/i]);
}

const session = await httpGet(urls.accountCurrent);
if (!session.ok) {
  addCheck('account:api-no-html-fallback', 'BLOCKED', { error: session.error });
} else {
  const goodStatus = [200, 401, 403].includes(session.status);
  addCheck('account:api-no-html-fallback', goodStatus && !isHtmlFallback(session) ? 'PASS' : 'FAIL', { http_status: session.status, content_type: session.contentType, html_fallback: isHtmlFallback(session) });
}

const play = await checkPage('play:root', urls.play);
if (play.ok && play.status === 200) {
  const playAssets = extractAssets(play.body || '', urls.play).filter((u) => /\.(?:js|wasm|data)(?:\?|$)/i.test(u));
  for (const asset of playAssets.slice(0, 50)) {
    const r = await httpGet(asset);
    let mimeOk = true;
    if (/\.wasm(?:\?|$)/i.test(asset)) mimeOk = /application\/wasm/i.test(r.contentType || '');
    if (/\.js(?:\?|$)/i.test(asset)) mimeOk = /(javascript|ecmascript)/i.test(r.contentType || '');
    const entry = { url: asset, http_status: r.status ?? null, content_type: r.contentType ?? null, mime_ok: mimeOk, error: r.error ?? null };
    result.discovered_assets.push(entry);
    addCheck(`play:asset:${asset}`, r.ok && r.status === 200 && mimeOk ? 'PASS' : (r.ok ? 'FAIL' : 'BLOCKED'), entry);

    if (/\.data(?:\?|$)/i.test(asset) && r.ok) {
      const range = await httpGet(asset, { headers: { Range: 'bytes=0-1023' } });
      addCheck(`play:data-range:${asset}`, range.ok && range.status === 206 ? 'PASS' : (range.ok ? 'FAIL' : 'BLOCKED'), { http_status: range.status ?? null, content_type: range.contentType ?? null, error: range.error ?? null });
    }
  }
  addCheck('play:real-client-assets-discovered', playAssets.some((u) => /\.wasm(?:\?|$)/i.test(u)) && playAssets.some((u) => /\.data(?:\?|$)/i.test(u)) ? 'PASS' : 'FAIL', { assets: playAssets });
}

const admin = await checkPage('admin:root', urls.admin, [/OldKO/i]);
const adminApi = await httpGet(urls.adminApi);
if (!adminApi.ok) {
  addCheck('admin:api-no-html-fallback', 'BLOCKED', { error: adminApi.error });
} else {
  addCheck('admin:api-no-html-fallback', !isHtmlFallback(adminApi) ? 'PASS' : 'FAIL', { http_status: adminApi.status, content_type: adminApi.contentType, html_fallback: isHtmlFallback(adminApi) });
}

const transportChecks = result.checks.filter((c) => c.id.startsWith('dns:') || c.id.startsWith('tls:') || c.id === 'website:homepage' || c.id === 'play:root' || c.id === 'admin:root');
if (transportChecks.some((c) => c.status === 'FAIL')) result.status = 'FAIL';
else if (transportChecks.some((c) => c.status === 'BLOCKED')) result.status = 'BLOCKED';
else result.status = result.checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PARTIAL_PASS_MANDATORY_FLOWS_NOT_RUN';

if (result.status !== 'PARTIAL_PASS_MANDATORY_FLOWS_NOT_RUN') {
  result.blockers.push({ owner: 'WS09', code: 'PUBLIC_ACCEPTANCE_GATE_NOT_REACHABLE', detail: 'Mandatory production user flows cannot run until all three HTTPS domains are reachable on the deployed release.' });
}

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ release_id: result.release_id, gate: result.gate, status: result.status, output: OUT, blockers: result.blockers }, null, 2));
process.exit(result.status === 'FAIL' ? 1 : 0);
