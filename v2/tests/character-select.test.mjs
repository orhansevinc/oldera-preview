import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CharacterPosition,
  CharacterSelectProcess,
  CharacterSelectRuntime,
  Nation,
  SelectAnimation,
  SELECTED_BLEND_SECONDS,
} from '../src/character-select/CharacterSelectRuntime.js';

test('1298 El Morad scene keeps source camera and slot transforms', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  const state = runtime.snapshot();

  assert.deepEqual(state.camera.eye, [0, -0.2, 7]);
  assert.deepEqual(state.camera.at, [0, -0.4, 0]);
  assert.equal(state.camera.fov, 0.96);
  assert.equal(state.background, 'ChrSelect/el_chairs.n3shape');
  assert.deepEqual(state.slotTransforms[0], { position: [0, -1.2, 2.74], yawDegrees: 0 });
  assert.deepEqual(state.slotTransforms[1], { position: [1.86, -1.2, 2], yawDegrees: 42 });
  assert.deepEqual(state.slotTransforms[2], { position: [-1.9, -1.2, 2], yawDegrees: -46 });
});

test('preselect uses animation 0 inside active area and dummy animation 2 outside', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  runtime.setCharacters([{ id: 'Orhan' }, null, null]);

  runtime.preselect(true);
  let state = runtime.snapshot();
  assert.equal(state.lastAnimationCommand.animation, SelectAnimation.PRE_SELECT);
  assert.equal(state.lightTheta, 0.015);

  runtime.preselect(false);
  state = runtime.snapshot();
  assert.equal(state.lastAnimationCommand.animation, SelectAnimation.DUMMY);
  assert.equal(state.lightTheta, 0);
});

test('empty slot enters character creation instead of sending select request', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  runtime.setCharacters([null, null, null]);

  assert.deepEqual(runtime.selectOrCreate(), { type: 'create-character', slot: 0 });
});

test('server-confirmed character selection uses source selected animation and 0.6 second blend', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  runtime.setCharacters([{ id: 'Orhan', zone: 21 }, null, null]);

  assert.deepEqual(runtime.selectOrCreate(), {
    type: 'select-character-request',
    slot: 0,
    characterId: 'Orhan',
    zone: 21,
  });

  runtime.confirmCharacterSelection(true);
  const state = runtime.snapshot();
  assert.equal(state.process, CharacterSelectProcess.SELECTED);
  assert.equal(state.lastAnimationCommand.animation, SelectAnimation.SELECTED);
  assert.equal(state.lastAnimationCommand.onceAndFreeze, true);
  assert.equal(state.lastAnimationCommand.blendSeconds, SELECTED_BLEND_SECONDS);
  assert.equal(state.lightTheta, 0.38);
  assert.equal(state.uiEnabled, false);
});

test('selected animation fades to black and enters main only after animation ends', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  runtime.setCharacters([{ id: 'Orhan' }, null, null]);
  runtime.selectOrCreate();
  runtime.confirmCharacterSelection(true);

  runtime.tick(1, { selectedAnimationEnded: false });
  assert.equal(runtime.snapshot().fadeAlpha, 45);
  assert.equal(runtime.snapshot().process, CharacterSelectProcess.SELECTED);

  runtime.tick(0, { selectedAnimationEnded: true });
  assert.equal(runtime.snapshot().process, CharacterSelectProcess.COMPLETE);
  assert.equal(runtime.consumePendingAction().type, 'enter-main');
});

test('camera rotates from center to left and returns to exact source center eye', () => {
  const runtime = new CharacterSelectRuntime({ nation: Nation.ELMORAD });
  runtime.setCharacters([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);

  assert.equal(runtime.requestLeft(), true);
  for (let i = 0; i < 300 && runtime.snapshot().process === CharacterSelectProcess.ROTATING; i += 1) {
    runtime.tick(1 / 60);
  }

  let state = runtime.snapshot();
  assert.equal(state.currentPosition, CharacterPosition.LEFT);
  assert.equal(state.process, CharacterSelectProcess.PRESELECT);
  assert.ok(state.camera.eye[0] > 0);

  assert.equal(runtime.requestRight(), true);
  for (let i = 0; i < 300 && runtime.snapshot().process === CharacterSelectProcess.ROTATING; i += 1) {
    runtime.tick(1 / 60);
  }

  state = runtime.snapshot();
  assert.equal(state.currentPosition, CharacterPosition.CENTER);
  assert.equal(state.process, CharacterSelectProcess.PRESELECT);
  assert.deepEqual(state.camera.eye, [0, -0.2, 7]);
});
