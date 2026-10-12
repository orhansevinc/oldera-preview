import {
  CharacterSelectRuntime,
  Nation,
} from '../character-select/CharacterSelectRuntime.js';
import {
  DevAccountStore,
  OLD_ERA_DEV_SERVER,
} from '../session/DevAccountStore.js';

export const GameFlowState = Object.freeze({
  LAUNCHER: 'launcher',
  LOGIN: 'login',
  SERVER_SELECT: 'server-select',
  NATION_SELECT: 'nation-select',
  CHARACTER_SELECT: 'character-select',
  CHARACTER_CREATE: 'character-create',
  WORLD_LOADING: 'world-loading',
  WORLD: 'world',
});

function assertState(actual, expected) {
  if (actual !== expected) {
    throw new Error(`Invalid flow state: expected ${expected}, got ${actual}`);
  }
}

export class GameFlowRuntime {
  constructor({ accountStore = new DevAccountStore() } = {}) {
    this.accountStore = accountStore;
    this.state = GameFlowState.LAUNCHER;
    this.characterSelect = null;
    this.pendingCreateSlot = null;
    this.pendingWorldEntry = null;
    this.lastError = null;
  }

  pressStart() {
    assertState(this.state, GameFlowState.LAUNCHER);
    this.lastError = null;
    this.state = GameFlowState.LOGIN;
    return this.snapshot();
  }

  login(username, password) {
    assertState(this.state, GameFlowState.LOGIN);
    const ok = this.accountStore.authenticate(username, password);
    if (!ok) {
      this.lastError = 'INVALID_CREDENTIALS';
      return false;
    }

    this.lastError = null;
    this.state = GameFlowState.SERVER_SELECT;
    return true;
  }

  selectServer(serverId = OLD_ERA_DEV_SERVER.id) {
    assertState(this.state, GameFlowState.SERVER_SELECT);
    this.accountStore.selectServer(serverId);
    this.lastError = null;

    if (this.accountStore.getNation() === null) {
      this.state = GameFlowState.NATION_SELECT;
    } else {
      this.#enterCharacterSelect();
    }
    return this.snapshot();
  }

  selectNation(nation) {
    assertState(this.state, GameFlowState.NATION_SELECT);
    if (nation !== Nation.KARUS && nation !== Nation.ELMORAD) {
      throw new RangeError(`Unsupported nation: ${nation}`);
    }

    this.accountStore.selectNation(nation);
    this.#enterCharacterSelect();
    return this.snapshot();
  }

  activateCurrentCharacter() {
    assertState(this.state, GameFlowState.CHARACTER_SELECT);
    const action = this.characterSelect.selectOrCreate();
    if (!action) return null;

    if (action.type === 'create-character') {
      this.pendingCreateSlot = action.slot;
      this.state = GameFlowState.CHARACTER_CREATE;
    }
    return action;
  }

  createCharacter(character) {
    assertState(this.state, GameFlowState.CHARACTER_CREATE);
    if (this.pendingCreateSlot === null) throw new Error('No character slot is pending creation.');

    const created = this.accountStore.createCharacter({
      ...character,
      slot: this.pendingCreateSlot,
    });

    this.pendingCreateSlot = null;
    this.#enterCharacterSelect();
    return created;
  }

  cancelCharacterCreate() {
    assertState(this.state, GameFlowState.CHARACTER_CREATE);
    this.pendingCreateSlot = null;
    this.#enterCharacterSelect();
    return this.snapshot();
  }

  confirmCharacterSelection(success) {
    assertState(this.state, GameFlowState.CHARACTER_SELECT);
    return this.characterSelect.confirmCharacterSelection(success);
  }

  moveCharacterLeft() {
    assertState(this.state, GameFlowState.CHARACTER_SELECT);
    return this.characterSelect.requestLeft();
  }

  moveCharacterRight() {
    assertState(this.state, GameFlowState.CHARACTER_SELECT);
    return this.characterSelect.requestRight();
  }

  preselectCharacter(pointerInsideActiveRegion) {
    assertState(this.state, GameFlowState.CHARACTER_SELECT);
    this.characterSelect.preselect(pointerInsideActiveRegion);
  }

  tick(deltaSeconds, options = {}) {
    if (this.state !== GameFlowState.CHARACTER_SELECT || !this.characterSelect) return;

    this.characterSelect.tick(deltaSeconds, options);
    const action = this.characterSelect.pendingAction;
    if (action?.type !== 'enter-main') return;

    this.characterSelect.consumePendingAction();
    this.pendingWorldEntry = {
      character: action.character,
      slot: action.slot,
      zone: action.character?.zone ?? null,
    };
    this.state = GameFlowState.WORLD_LOADING;
  }

  completeWorldLoad(worldInfo = {}) {
    assertState(this.state, GameFlowState.WORLD_LOADING);
    this.pendingWorldEntry = {
      ...this.pendingWorldEntry,
      ...worldInfo,
    };
    this.state = GameFlowState.WORLD;
    return this.snapshot();
  }

  snapshot() {
    return {
      state: this.state,
      lastError: this.lastError,
      server: OLD_ERA_DEV_SERVER,
      nation: this.#safeNation(),
      pendingCreateSlot: this.pendingCreateSlot,
      pendingWorldEntry: this.pendingWorldEntry ? { ...this.pendingWorldEntry } : null,
      characterSelect: this.characterSelect?.snapshot() ?? null,
    };
  }

  #safeNation() {
    try {
      return this.accountStore.getNation();
    } catch {
      return null;
    }
  }

  #enterCharacterSelect() {
    const nation = this.accountStore.getNation();
    if (nation === null) throw new Error('Nation is required before character selection.');

    this.characterSelect = new CharacterSelectRuntime({ nation });
    this.characterSelect.setCharacters(this.accountStore.listCharacters());
    this.pendingCreateSlot = null;
    this.state = GameFlowState.CHARACTER_SELECT;
  }
}
