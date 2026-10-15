#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildNpcCoverage } = require('../../services/ko1298-npc/production');

const root = path.resolve(__dirname, '../..');
const catalogPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'world-data/npc/moradon.json');
const document = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const records = buildNpcCoverage(document);
const summary = records.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] || 0) + 1;
  return acc;
}, {});

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedFrom: path.relative(root, catalogPath).replaceAll('\\', '/'),
  zoneId: document.zoneId,
  zoneName: document.zoneName || null,
  templateCount: records.length,
  spawnCount: records.reduce((count, row) => count + row.spawns.length, 0),
  statusSummary: summary,
  records,
}, null, 2)}\n`);
