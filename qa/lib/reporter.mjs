import fs from 'node:fs';
import path from 'node:path';

export const milestoneNames = [
  'package integrity','WASM runtime ready','WebGL renderer active','Login scene visible',
  'Auth handshake','Server list','Game connect','Version 1298','Game login','Nation Select',
  'Character Select','Character Create','Character selectable','Zone transition',
  'Moradon terrain render','Player spawn','movement/input','Admin API health',
  'Admin player lookup','ban/unban API','persistence restart test'
];

export class Reporter {
  constructor(dir = process.env.QA_ARTIFACT_DIR || 'artifacts') {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'milestones.json');
    this.data = { generatedAt: new Date().toISOString(), milestones: {} };
    if (fs.existsSync(this.file)) {
      try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    }
  }
  set(id, status, detail, evidence = {}) {
    const key = `M${id}`;
    this.data.generatedAt = new Date().toISOString();
    this.data.milestones[key] = { id: key, name: milestoneNames[id], status, detail, evidence, at: new Date().toISOString() };
    this.flush();
  }
  pass(id, detail, evidence = {}) { this.set(id, 'PASS', detail, evidence); }
  fail(id, detail, evidence = {}) { this.set(id, 'FAIL', detail, evidence); }
  flush() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n'); }
  summary() {
    return Array.from({ length: 21 }, (_, i) => this.data.milestones[`M${i}`] || { id:`M${i}`,name:milestoneNames[i],status:'FAIL',detail:'No evidence produced' });
  }
}

export function appendLog(dir, name, text) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, name), String(text) + '\n');
}
