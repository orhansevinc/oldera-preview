import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = Object.freeze({ N: 32768, r: 8, p: 1, keylen: 32 });

export class ScryptPasswordHasher {
  async hash(password) {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024 });
    return `$scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
  }

  async verify(password, encoded) {
    try {
      if (typeof encoded !== 'string') return false;
      if (encoded.startsWith('$scrypt$')) return this.#verifyWs13(password, encoded);
      if (encoded.startsWith('scrypt$')) return this.#verifyWs07(password, encoded);
      return false;
    } catch { return false; }
  }

  async #verifyWs13(password, encoded) {
    const parts = encoded.split('$');
    if (parts.length !== 5 || parts[1] !== 'scrypt') return false;
    const params = Object.fromEntries(parts[2].split(',').map((entry) => entry.split('=')));
    return verifyDerived(password, Buffer.from(parts[3], 'base64url'), Buffer.from(parts[4], 'base64url'), Number(params.N), Number(params.r), Number(params.p));
  }

  async #verifyWs07(password, encoded) {
    const [kind, nRaw, rRaw, pRaw, saltRaw, hashRaw] = encoded.split('$');
    if (kind !== 'scrypt' || !hashRaw) return false;
    return verifyDerived(password, Buffer.from(saltRaw, 'base64'), Buffer.from(hashRaw, 'base64'), Number(nRaw), Number(rRaw), Number(pRaw));
  }
}

async function verifyDerived(password, salt, expected, N, r, p) {
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;
  if (N < 16384 || N > 131072 || r < 1 || r > 16 || p < 1 || p > 4) return false;
  if (salt.length < 16 || expected.length < 32 || expected.length > 64) return false;
  const actual = Buffer.from(await scrypt(password, salt, expected.length, { N, r, p, maxmem: 128 * 1024 * 1024 }));
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function newOpaqueToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
export function digestToken(token) { return crypto.createHash('sha256').update(token, 'utf8').digest('hex'); }
export function newId() { return crypto.randomUUID(); }
