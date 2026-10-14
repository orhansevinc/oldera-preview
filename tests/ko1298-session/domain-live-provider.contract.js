'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  DOMAIN_LIVE_PROVIDER_PINS,
  createProductionProviderComposition,
} = require('../../services/ko1298-session/production-composition');

const world = require('../../services/ko1298-world');
const movement = require('../../services/ko1298-movement');
const npc = require('../../services/ko1298-npc');
const mobs = require('../../services/ko1298-mobs');

class ContractRepository {
  constructor() { this.npcWorld = null; }
  setNpcWorld(value) { this.npcWorld = value; }
  async getCharacterForWorld() { return null; }
  async getAuthoritativeWorldState() { return null; }
  async getSurroundingUsers() { return []; }
  async getSurroundingNpcs({ zoneId, x, z }) { return this.npcWorld.nearby(zoneId, x, z); }
  async saveWorldPosition() { return {}; }
}

test('domain-live production composition consumes real C5-compatible WS14/WS15/WS16/WS25 provider surfaces', () => {
  const repository = new ContractRepository();
  const composition = createProductionProviderComposition({
    repository,
    env: {
      OLDKO_MORADON_NPC_DATA: path.resolve(__dirname, '../../world-data/npc/moradon.json'),
      OLDKO_MORADON_MOB_DATA: path.resolve(__dirname, '../../world-data/mobs/verified/moradon-zone21.verified.json'),
    },
    providers: { world, movement, npc, mobs },
    heightResolver: {
      resolveHeight(zoneId, x, z) {
        assert.equal(Number(zoneId), 21);
        assert.equal(Number.isFinite(x), true);
        assert.equal(Number.isFinite(z), true);
        return { status: 'authoritative', height: 0, surface: 'contract-authoritative-height' };
      },
    },
  });

  assert.deepEqual(composition.providerPins, DOMAIN_LIVE_PROVIDER_PINS);
  assert.ok(composition.evidence.npcRecords > 0);
  assert.equal(composition.evidence.mobRecords, 135);
  assert.equal(composition.evidence.sharedRuntimeNamespace.claimed, 135);
  assert.equal(composition.evidence.sharedRuntimeNamespace.occupied,
    composition.evidence.npcRecords + composition.evidence.mobRecords);
  assert.ok(repository.npcWorld);
  assert.ok(composition.worldSession);
  assert.ok(composition.movementSession);
});
