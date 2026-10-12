import test from 'node:test';
import assert from 'node:assert/strict';

import { Nation, SelectAnimation } from '../src/character-select/CharacterSelectRuntime.js';
import { GameFlowRuntime, GameFlowState } from '../src/game-flow/GameFlowRuntime.js';
import { OLD_ERA_DEV_SERVER } from '../src/session/DevAccountStore.js';

// Synthetic only: authentic Moradon zone mapping will come from 1298 Zones.tbl.
const TEST_ZONE_ID = 777;

test('OldERA v2 follows launcher -> login -> server -> nation -> character create', () => {
  const flow = new GameFlowRuntime();

  assert.equal(flow.snapshot().state, GameFlowState.LAUNCHER);
  flow.pressStart();
  assert.equal(flow.snapshot().state, GameFlowState.LOGIN);

  assert.equal(flow.login('wrong', 'wrong'), false);
  assert.equal(flow.snapshot().state, GameFlowState.LOGIN);
  assert.equal(flow.snapshot().lastError, 'INVALID_CREDENTIALS');

  assert.equal(flow.login('osevinc', 'osevinc'), true);
  assert.equal(flow.snapshot().state, GameFlowState.SERVER_SELECT);

  flow.selectServer(OLD_ERA_DEV_SERVER.id);
  assert.equal(flow.snapshot().state, GameFlowState.NATION_SELECT);

  flow.selectNation(Nation.ELMORAD);
  assert.equal(flow.snapshot().state, GameFlowState.CHARACTER_SELECT);
  assert.deepEqual(flow.snapshot().characterSelect.currentCharacter, null);

  const createAction = flow.activateCurrentCharacter();
  assert.deepEqual(createAction, { type: 'create-character', slot: 0 });
  assert.equal(flow.snapshot().state, GameFlowState.CHARACTER_CREATE);

  flow.createCharacter({
    id: 'Orhan',
    race: 12,
    classId: 201,
    face: 1,
    hair: 1,
    zone: TEST_ZONE_ID,
  });

  assert.equal(flow.snapshot().state, GameFlowState.CHARACTER_SELECT);
  assert.equal(flow.snapshot().characterSelect.currentCharacter.id, 'Orhan');
});

test('selected character completes original animation before world loading', () => {
  const flow = new GameFlowRuntime();
  flow.pressStart();
  flow.login('osevinc', 'osevinc');
  flow.selectServer();
  flow.selectNation(Nation.ELMORAD);
  flow.activateCurrentCharacter();
  flow.createCharacter({ id: 'Orhan', race: 12, classId: 201, zone: TEST_ZONE_ID });

  const selectRequest = flow.activateCurrentCharacter();
  assert.equal(selectRequest.type, 'select-character-request');
  assert.equal(selectRequest.characterId, 'Orhan');

  const animation = flow.confirmCharacterSelection(true);
  assert.equal(animation.animation, SelectAnimation.SELECTED);
  assert.equal(animation.blendSeconds, 0.6);
  assert.equal(flow.snapshot().state, GameFlowState.CHARACTER_SELECT);

  flow.tick(1, { selectedAnimationEnded: false });
  assert.equal(flow.snapshot().state, GameFlowState.CHARACTER_SELECT);
  assert.equal(flow.snapshot().characterSelect.fadeAlpha, 45);

  flow.tick(0, { selectedAnimationEnded: true });
  assert.equal(flow.snapshot().state, GameFlowState.WORLD_LOADING);
  assert.equal(flow.snapshot().pendingWorldEntry.character.id, 'Orhan');
  assert.equal(flow.snapshot().pendingWorldEntry.zone, TEST_ZONE_ID);

  flow.completeWorldLoad({ terrainReady: true });
  assert.equal(flow.snapshot().state, GameFlowState.WORLD);
  assert.equal(flow.snapshot().pendingWorldEntry.terrainReady, true);
});
