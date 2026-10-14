'use strict';

const fs = require('node:fs');

function idsFor(text, regex) {
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(regex);
    if (match) ids.add(Number(match[1]));
  }
  return ids;
}

function recordsFor(text, prefix) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(prefix);
    if (index < 0) continue;
    const tail = line.slice(index + prefix.length).trim();
    const record = {};
    for (const token of tail.split(/\s+/)) {
      const eq = token.indexOf('=');
      if (eq <= 0) continue;
      record[token.slice(0, eq)] = token.slice(eq + 1);
    }
    records.push(record);
  }
  return records;
}

function idSetFromRecords(records, predicate = () => true) {
  return new Set(records.filter(predicate).map((record) => Number(record.id)).filter(Number.isInteger));
}

function intersection(...sets) {
  if (!sets.length) return new Set();
  return new Set([...sets[0]].filter((value) => sets.slice(1).every((set) => set.has(value))));
}

function requireTrue(condition, message) {
  if (!condition) throw new Error(message);
}

function captureEvidence(driverLog) {
  const marker = driverLog.split(/\r?\n/).find((line) => line.includes('WS10_VISIBILITY_V2_CAPTURE_OK'));
  if (!marker) return null;
  const npc = Number(marker.match(/\bnpc=(-?\d+)/)?.[1]);
  const mob = Number(marker.match(/\bmob=(-?\d+)/)?.[1]);
  const artifact = marker.match(/\bartifact=([^\s]+)/)?.[1] || null;
  return { marker, npc, mob, artifact };
}

function proveVisibilityV2({ serverLog, driverLog, expectedProviderSet }) {
  requireTrue(typeof expectedProviderSet === 'string' && /^WS50-[A-Z0-9]+@sha256:[0-9a-f]{64}$/.test(expectedProviderSet), 'exact immutable provider-set ID required');
  requireTrue(serverLog.includes(`provider_set=${expectedProviderSet}`), 'server evidence is not bound to requested immutable provider-set');

  const authority = {
    npc: idsFor(serverLog, /WS10_AUTH type=npc id=(-?\d+)/),
    mob: idsFor(serverLog, /WS10_AUTH type=mob id=(-?\d+)/),
  };
  requireTrue(authority.npc.size > 0, 'no authoritative real NPC IDs in server evidence');
  requireTrue(authority.mob.size > 0, 'no authoritative real mob IDs in server evidence');

  const bounds = recordsFor(driverLog, 'WS10_VISIBILITY_V2 BOUNDS');
  const pixel = recordsFor(driverLog, 'WS10_VISIBILITY_V2 PIXEL_DELTA');
  const stages = {
    detail: idsFor(driverLog, /WS10_VISIBILITY DETAIL_RECORD id=(-?\d+)/),
    entityCreate: idsFor(driverLog, /WS10_VISIBILITY ENTITY_CREATE id=(-?\d+)/),
    authoritativeModel: idsFor(driverLog, /WS10_VISIBILITY MODEL_READY id=(-?\d+).*source=authority/),
    transform: idSetFromRecords(bounds, (r) => r.transform === 'valid' && r.front === '1' && r.frustum === '1' && r.screen === '1' && Number(r.area) > 0 && r.bounds_source === 'native-minmax'),
    drawSubmit: idsFor(driverLog, /WS10_VISIBILITY_V2 DRAW_SUBMIT id=(-?\d+)/),
    pixelDelta: idSetFromRecords(pixel, (r) => Number(r.changed) >= 2 && Number(r.total) > 0),
    humanVisible: idsFor(driverLog, /WS10_VISIBILITY_V2 HUMAN_VISIBLE id=(-?\d+)/),
  };

  const chain = {
    npc: [...intersection(authority.npc, stages.detail, stages.entityCreate, stages.authoritativeModel, stages.transform, stages.drawSubmit, stages.pixelDelta, stages.humanVisible)].sort((a, b) => a - b),
    mob: [...intersection(authority.mob, stages.detail, stages.entityCreate, stages.authoritativeModel, stages.transform, stages.drawSubmit, stages.pixelDelta, stages.humanVisible)].sort((a, b) => a - b),
  };

  requireTrue(chain.npc.length > 0, 'no real NPC reached the human-visible pixel chain');
  requireTrue(chain.mob.length > 0, 'no real mob reached the human-visible pixel chain');

  const capture = captureEvidence(driverLog);
  requireTrue(capture, 'missing native framebuffer screenshot taken after V2 human-visible evidence');
  requireTrue(chain.npc.includes(capture.npc), `V2 screenshot NPC ${capture.npc} is not a proven human-visible authoritative NPC`);
  requireTrue(chain.mob.includes(capture.mob), `V2 screenshot mob ${capture.mob} is not a proven human-visible authoritative mob`);
  requireTrue(capture.artifact && /\.png$/i.test(capture.artifact), 'V2 screenshot artifact path missing');
  requireTrue(driverLog.includes('WS10_BROWSER_MOVEMENT_INPUT complete=1'), 'real browser movement input evidence missing');

  // Historical C5 used this generic marker. It remains valid historical evidence,
  // but by itself it must never satisfy V2.
  const genericOnly = driverLog.includes('WS10_VISIBILITY_CAPTURE_OK') && !driverLog.includes('WS10_VISIBILITY_V2 HUMAN_VISIBLE');
  requireTrue(!genericOnly, 'generic non-black framebuffer capture cannot satisfy Visibility V2');

  return {
    schema: 'oldkoweb.ws10.visibility-v2-proof.v1',
    providerSet: expectedProviderSet,
    result: 'PASS',
    acceptance: 'NETWORK_TO_HUMAN_VISIBLE_ENTITY_PIXELS',
    npc: { authoritativeCount: authority.npc.size, provenIds: chain.npc },
    mob: { authoritativeCount: authority.mob.size, provenIds: chain.mob },
    screenshot: capture,
    requiredStages: [
      'network-record', 'entity-create', 'authoritative-model', 'valid-native-world-bounds',
      'camera-front', 'native-frustum', 'viewport-screen-bounds', 'native-render-submission',
      'entity-specific-framebuffer-delta', 'native-frame-screenshot',
    ],
  };
}

if (require.main === module) {
  const [serverPath, driverPath, expectedProviderSet, outputPath] = process.argv.slice(2);
  if (!serverPath || !driverPath || !expectedProviderSet) {
    console.error('usage: node verify-visibility-v2.cjs <server.log> <driver.log> <provider-set-id> [proof.json]');
    process.exit(64);
  }
  try {
    const proof = proveVisibilityV2({
      serverLog: fs.readFileSync(serverPath, 'utf8'),
      driverLog: fs.readFileSync(driverPath, 'utf8'),
      expectedProviderSet,
    });
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
    console.log(`WS10_VISIBILITY_V2_GATE PASS provider_set=${expectedProviderSet} npc=${proof.npc.provenIds.join(',')} mob=${proof.mob.provenIds.join(',')}`);
  } catch (error) {
    console.error(`WS10_VISIBILITY_V2_GATE FAIL ${error.message}`);
    process.exit(1);
  }
}

module.exports = { proveVisibilityV2 };
