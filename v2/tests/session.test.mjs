import test from 'node:test';
import assert from 'node:assert/strict';

import { Nation } from '../src/character-select/CharacterSelectRuntime.js';
import {
  DevAccountStore,
  OLD_ERA_DEV_CREDENTIALS,
  OLD_ERA_DEV_SERVER,
} from '../src/session/DevAccountStore.js';

test('OldERA dev credentials are osevinc / osevinc', () => {
  const store = new DevAccountStore();

  assert.equal(store.authenticate('wrong', 'wrong'), false);
  assert.equal(
    store.authenticate(OLD_ERA_DEV_CREDENTIALS.username, OLD_ERA_DEV_CREDENTIALS.password),
    true,
  );
  assert.equal(store.selectServer(OLD_ERA_DEV_SERVER.id).name, 'OldERA 1298');
});

test('dev account starts empty so original nation -> create character route remains testable', () => {
  const store = new DevAccountStore();
  store.authenticate('osevinc', 'osevinc');

  assert.equal(store.getNation(), null);
  assert.deepEqual(store.listCharacters(), [null, null, null]);

  store.selectNation(Nation.ELMORAD);
  const character = store.createCharacter({
    slot: 0,
    id: 'Orhan',
    race: 12,
    classId: 201,
    face: 1,
    hair: 1,
  });

  assert.equal(character.id, 'Orhan');
  assert.equal(character.nation, Nation.ELMORAD);
  assert.equal(store.listCharacters()[0].id, 'Orhan');
});

test('there are exactly three 1298 character slots and duplicate names are rejected', () => {
  const store = new DevAccountStore();
  store.authenticate('osevinc', 'osevinc');
  store.selectNation(Nation.KARUS);

  store.createCharacter({ slot: 0, id: 'One', race: 1, classId: 101 });
  assert.throws(
    () => store.createCharacter({ slot: 1, id: 'one', race: 1, classId: 101 }),
    /already exists/,
  );
  assert.throws(
    () => store.createCharacter({ slot: 3, id: 'Four', race: 1, classId: 101 }),
    /slot must be between 0 and 2/,
  );
});
