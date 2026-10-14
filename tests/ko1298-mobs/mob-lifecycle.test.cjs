'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../world-data/mobs/fixtures/moradon-lifecycle.fixture.json');
const { MobService, MobState, validateWorldDefinition } = require('../../services/ko1298-mobs');

test('legacy WS25 fixture contract remains explicitly synthetic and initializes idle', () => {
  const definition = validateWorldDefinition(fixture);
  assert.equal(definition.dataClass, 'fixture');
  const service = new MobService(fixture);
  const mobs = service.initialize(0);
  assert.equal(mobs.length, 2);
  assert.equal(mobs.every((mob) => mob.state === MobState.IDLE), true);
});

test('real data without provenance remains rejected', () => {
  const real = JSON.parse(JSON.stringify(fixture));
  real.dataClass = 'real';
  real.zoneId = '21';
  real.templates[0].dataClass = 'real';
  real.templates[0].templateId = 'ko1298:monster:9999';
  delete real.templates[0].sourceRef;
  real.spawnGroups[0].groupId = 'ko1298:21:9999:test';
  real.spawnGroups[0].templateId = 'ko1298:monster:9999';
  real.spawnGroups[0].zoneId = '21';
  for (const spawn of real.spawnGroups[0].spawns) spawn.zoneId = '21';
  assert.throws(() => validateWorldDefinition(real), /sourceRef is required for real data/);
});
