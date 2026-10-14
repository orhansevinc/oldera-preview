#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const getArg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const outputRoot = path.resolve(getArg('--output', 'artifacts/ws49'));
const jsonPath = path.join(outputRoot, 'integration-report.json');
const mdPath = path.join(outputRoot, 'integration-report.md');
const report = JSON.parse(await readFile(jsonPath, 'utf8'));

const g = report.scenarios.find((x) => x.id === 'G');
if (g?.status === 'BLOCKED') {
  const message = 'WS26 production drop semantics are source-backed, but current WS31 does not yet expose the full verified K_MONSTER/K_MONSTER_ITEM/MAKE_ITEM_GROUP/item catalog, and the WS25 -> WS26 -> WS17 production adapter chain is not composed.';
  const missingContract = 'full WS31 K_MONSTER/K_MONSTER_ITEM/MAKE_ITEM_GROUP/item catalog + WS25 death event adapter + WS17 production item grant adapter';
  g.actual = message;
  g.firstFailingEvent = missingContract;
  if (g.blocker) { g.blocker.message = message; g.blocker.missingContract = missingContract; }
}

const h = report.scenarios.find((x) => x.id === 'H');
if (h?.status === 'BLOCKED') {
  const message = 'WS27 current provider verifies max level 80 and progression runtime semantics, but current WS31 still lacks the exact LEVEL_UP.RequiredExp thresholds and mob-to-XP reward mapping.';
  const missingContract = 'WS31 verified 1298 LEVEL_UP.RequiredExp thresholds + mob-to-XP reward mapping -> WS27 LevelTablePort/KillRewardPort';
  h.actual = message;
  h.firstFailingEvent = missingContract;
  if (h.blocker) { h.blocker.message = message; h.blocker.missingContract = missingContract; }
}

report.topBlockers = report.scenarios.filter((x) => x.status === 'BLOCKED').slice(0, 5).map((x) => ({
  scenario: x.id,
  message: x.blocker?.message || x.actual,
  missingContract: x.blocker?.missingContract || x.firstFailingEvent
}));
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

let md = await readFile(mdPath, 'utf8');
md = md
  .replaceAll('WS26 synthetic domain path works, but WS31 has no authoritative 1298 drop catalog and the WS25 -> WS26 -> WS17 production adapter chain is not composed.', g?.actual || '')
  .replaceAll('verified monster->drop table + WS25 death event adapter + WS17 production item grant adapter', g?.firstFailingEvent || '')
  .replaceAll('WS27 delegates exact XP thresholds/max level to LevelTablePort and WS31 current catalog has no verified progression curve.', h?.actual || '')
  .replaceAll('WS31 verified 1298 XP threshold/max-level data -> WS27 LevelTablePort', h?.firstFailingEvent || '');
await writeFile(mdPath, md);
