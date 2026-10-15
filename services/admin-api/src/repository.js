'use strict';

const crypto = require('node:crypto');

const REQUIRED_METHODS = [
  'transaction', 'overview', 'listPlayers', 'getCharacter', 'updateCharacter', 'updateStats', 'updateSkills',
  'getInventory', 'getInn', 'getTransactions', 'getSanctions', 'searchItems', 'itemHistory', 'itemAction',
  'findDuplicateSerials', 'createSanction', 'removeSanction', 'appendAudit', 'listAudit', 'enqueueCommand'
];

function assertRepository(repo) {
  for (const method of REQUIRED_METHODS) if (typeof repo?.[method] !== 'function') throw new TypeError(`Admin repository missing method: ${method}`);
  return repo;
}

function clone(value) { return structuredClone(value); }

class MemoryAdminRepository {
  constructor(seed = {}) {
    this.characters = clone(seed.characters || [
      { name: 'osevinc', account: 'osevinc', nation: 'El Morad', className: 'Warrior', level: 70, np: 48920, coin: 37400000, zone: 'Moradon', online: true, banned: false, ipBanned: false, last: 'Şimdi', ip: '127.0.0.1', x: 822.4, z: 536.1, initial: 'O' },
      { name: 'Suspicious', account: 'testdup', nation: 'Karus', className: 'Warrior', level: 62, np: 4200, coin: 860000000, zone: 'Luferson', online: false, banned: false, ipBanned: false, last: '2 saat önce', ip: '198.51.100.44', x: 440.1, z: 781.7, initial: 'S' }
    ]);
    this.inventories = clone(seed.inventories || {
      osevinc: {
        equipment: Array.from({ length: 14 }, (_, i) => i === 7 ? { slot: i, itemId: 120310000, serial: 'OK-OSEVINC-RAPTOR-1', count: 1, duration: 12000 } : { slot: i, empty: true }),
        inventory: Array.from({ length: 28 }, (_, i) => i === 0 ? { slot: i, itemId: 389010000, serial: 'STACK-HP-1', count: 9999, duration: 0 } : { slot: i, empty: true })
      },
      Suspicious: {
        equipment: Array.from({ length: 14 }, (_, i) => ({ slot: i, empty: true })),
        inventory: Array.from({ length: 28 }, (_, i) => [14, 15].includes(i) ? { slot: i, itemId: 120310000, serial: 'DUP-SERIAL-778899', count: 1, duration: 12000 } : { slot: i, empty: true })
      }
    });
    this.inns = clone(seed.inns || {
      osevinc: { slots: Array.from({ length: 192 }, (_, i) => ({ slot: i, empty: true })) },
      Suspicious: { slots: Array.from({ length: 192 }, (_, i) => i === 18 ? { slot: i, itemId: 120310000, serial: 'DUP-SERIAL-778899', count: 1, duration: 12000 } : ({ slot: i, empty: true })) }
    });
    this.sanctions = clone(seed.sanctions || []);
    this.audit = clone(seed.audit || []);
    this.transactions = clone(seed.transactions || {});
    this.commands = clone(seed.commands || []);
    this.itemFlags = clone(seed.itemFlags || {});
  }

  async transaction(fn) {
    const snapshot = clone({ characters: this.characters, inventories: this.inventories, inns: this.inns, sanctions: this.sanctions, audit: this.audit, transactions: this.transactions, commands: this.commands, itemFlags: this.itemFlags });
    try { return await fn(this); }
    catch (error) { Object.assign(this, snapshot); throw error; }
  }

  async overview() { return { online: this.characters.filter((c) => c.online).length, characters: this.characters.length, sanctions: this.sanctions.filter((s) => s.active).length, duplicateSerials: (await this.findDuplicateSerials()).duplicates.length }; }

  async listPlayers({ online = false, q = '', limit = 1000 } = {}) {
    const needle = String(q || '').trim().toLowerCase();
    return this.characters.filter((p) => !online || p.online).filter((p) => !needle || [p.name, p.account, p.nation, p.className, p.zone, p.ip].some((v) => String(v || '').toLowerCase().includes(needle))).slice(0, limit).map(clone);
  }

  async getCharacter(name) { return clone(this.characters.find((c) => c.name.toLowerCase() === String(name).toLowerCase()) || null); }

  async updateCharacter(name, patch) { const row = this.characters.find((c) => c.name.toLowerCase() === String(name).toLowerCase()); if (!row) return null; Object.assign(row, patch); return clone(row); }
  async updateStats(name, patch) { return this.updateCharacter(name, { stats: { ...((await this.getCharacter(name))?.stats || {}), ...patch } }); }
  async updateSkills(name, patch) { return this.updateCharacter(name, { skills: { ...((await this.getCharacter(name))?.skills || {}), ...patch } }); }
  async getInventory(name) { return clone(this.inventories[name] || { equipment: Array.from({ length: 14 }, (_, slot) => ({ slot, empty: true })), inventory: Array.from({ length: 28 }, (_, slot) => ({ slot, empty: true })) }); }
  async getInn(name) { return clone(this.inns[name] || { slots: Array.from({ length: 192 }, (_, slot) => ({ slot, empty: true })) }); }
  async getTransactions(name) { return clone(this.transactions[name] || []); }
  async getSanctions(name) { const character = await this.getCharacter(name); if (!character) return []; return clone(this.sanctions.filter((s) => s.character.toLowerCase() === character.name.toLowerCase())); }

  allItems() {
    const rows = [];
    for (const character of this.characters) {
      const inv = this.inventories[character.name] || { equipment: [], inventory: [] };
      const inn = this.inns[character.name] || { slots: [] };
      for (const [scope, slots] of [['equipment', inv.equipment], ['inventory', inv.inventory], ['inn', inn.slots]]) {
        for (const slot of slots || []) if (slot && !slot.empty && slot.serial && slot.serial !== '0') rows.push({ character: character.name, account: character.account, scope, slot: slot.slot, ...clone(slot) });
      }
    }
    return rows;
  }

  async searchItems(query) { const q = String(query || '').trim().toLowerCase(); return this.allItems().filter((i) => !q || [i.serial, i.itemId, i.character, i.account].some((v) => String(v).toLowerCase().includes(q))).slice(0, 250); }
  async itemHistory(serial) { return this.allItems().filter((i) => i.serial === serial).map((i) => ({ at: new Date(0).toISOString(), action: 'CURRENT_LOCATION', ...i })); }
  async itemAction(serial, action) { const matches = this.allItems().filter((i) => i.serial === serial); if (!matches.length) return null; this.itemFlags[serial] = { ...(this.itemFlags[serial] || {}), ...clone(action), updatedAt: new Date().toISOString() }; return { serial, matches, flag: clone(this.itemFlags[serial]) }; }
  async findDuplicateSerials() { const bySerial = new Map(); for (const row of this.allItems()) { const list = bySerial.get(row.serial) || []; list.push(row); bySerial.set(row.serial, list); } return { duplicates: [...bySerial.entries()].filter(([, rows]) => rows.length > 1).map(([serial, rows]) => ({ serial, count: rows.length, locations: rows })) }; }

  async createSanction({ character, type, reason, actor, traceId }) {
    const row = this.characters.find((c) => c.name.toLowerCase() === String(character).toLowerCase());
    if (!row) return null;
    const sanction = { id: crypto.randomUUID(), character: row.name, account: row.account, ip: row.ip, type, reason, actor, traceId, active: true, createdAt: new Date().toISOString() };
    this.sanctions.push(sanction);
    if (type === 'IP') row.ipBanned = true; else row.banned = true;
    return clone(sanction);
  }

  async removeSanction({ character, type }) {
    const row = this.characters.find((c) => c.name.toLowerCase() === String(character).toLowerCase());
    if (!row) return null;
    const normalized = String(type || '').toUpperCase();
    for (const sanction of this.sanctions) if (sanction.character.toLowerCase() === row.name.toLowerCase() && (!normalized || sanction.type === normalized)) sanction.active = false;
    if (!normalized || normalized === 'ACCOUNT') row.banned = false;
    if (!normalized || normalized === 'IP') row.ipBanned = false;
    return clone(row);
  }

  async appendAudit(entry) { const row = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), result: 'SUCCESS', ...clone(entry) }; this.audit.unshift(row); return clone(row); }
  async listAudit(limit = 100) { return clone(this.audit.slice(0, limit)); }
  async enqueueCommand(command) { const row = { id: crypto.randomUUID(), status: 'PENDING_BRIDGE', createdAt: new Date().toISOString(), ...clone(command) }; this.commands.push(row); return clone(row); }
}

module.exports = { REQUIRED_METHODS, assertRepository, MemoryAdminRepository };
