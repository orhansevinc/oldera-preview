// Source-faithful web runtime model for KO 1298 character selection.
// Behavior is ported from CGameProcCharacterSelect; rendering stays downstream.

export const Nation = Object.freeze({
  KARUS: 1,
  ELMORAD: 2,
});

export const CharacterPosition = Object.freeze({
  CENTER: 1,
  LEFT: 2,
  RIGHT: 3,
});

export const CharacterSelectProcess = Object.freeze({
  ROTATING: 1,
  PRESELECT: 2,
  SELECTED: 3,
  COMPLETE: 4,
});

export const SelectAnimation = Object.freeze({
  PRE_SELECT: 0,
  SELECTED: 1,
  DUMMY: 2,
});

export const MAX_AVAILABLE_CHARACTER = 3;
export const SELECTED_BLEND_SECONDS = 0.6;
export const CAMERA_ROTATION_RADIANS_PER_SECOND = 1.2;
export const FADE_ALPHA_PER_SECOND = 45;

const SOURCE_SCENE = Object.freeze({
  [Nation.KARUS]: Object.freeze({
    camera: Object.freeze({
      eye: Object.freeze([0.0, -0.2, 7.4]),
      at: Object.freeze([0.0, -0.4, 0.0]),
      up: Object.freeze([0.0, 1.0, 0.0]),
      near: 0.1,
      far: 100.0,
      fov: 0.96,
    }),
    background: 'ChrSelect/ka_chairs.n3shape',
    lights: Object.freeze([
      'ChrSelect/ka_light_0.n3light',
      'ChrSelect/ka_light_1.n3light',
      'ChrSelect/ka_light_2.n3light',
    ]),
    slots: Object.freeze([
      Object.freeze({ position: [0.0, -1.16, 2.72], yawDegrees: 0.0 }),
      Object.freeze({ position: [1.86, -1.16, 2.1], yawDegrees: 42.0 }),
      Object.freeze({ position: [-1.9, -1.16, 2.1], yawDegrees: -42.0 }),
    ]),
    lightThetaMax: 0.5,
    lightThetaStepPerTick: 0.02,
    rotateLeftDotThreshold: 0.75,
    rotateRightDotThreshold: 0.77,
  }),
  [Nation.ELMORAD]: Object.freeze({
    camera: Object.freeze({
      eye: Object.freeze([0.0, -0.2, 7.0]),
      at: Object.freeze([0.0, -0.4, 0.0]),
      up: Object.freeze([0.0, 1.0, 0.0]),
      near: 0.1,
      far: 100.0,
      fov: 0.96,
    }),
    background: 'ChrSelect/el_chairs.n3shape',
    lights: Object.freeze([
      'ChrSelect/el_light_0.n3light',
      'ChrSelect/el_light_1.n3light',
      'ChrSelect/el_light_2.n3light',
    ]),
    slots: Object.freeze([
      Object.freeze({ position: [0.0, -1.2, 2.74], yawDegrees: 0.0 }),
      Object.freeze({ position: [1.86, -1.2, 2.0], yawDegrees: 42.0 }),
      Object.freeze({ position: [-1.9, -1.2, 2.0], yawDegrees: -46.0 }),
    ]),
    lightThetaMax: 0.38,
    lightThetaStepPerTick: 0.015,
    rotateLeftDotThreshold: 0.74,
    rotateRightDotThreshold: 0.73,
  }),
});

function clone3(v) {
  return [v[0], v[1], v[2]];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]);
  if (length === 0) return [0, 0, 0];
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function rotateY(v, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    v[0] * c + v[2] * s,
    v[1],
    -v[0] * s + v[2] * c,
  ];
}

function slotIndexFromPosition(position) {
  switch (position) {
    case CharacterPosition.CENTER: return 0;
    case CharacterPosition.LEFT: return 1;
    case CharacterPosition.RIGHT: return 2;
    default: throw new RangeError(`Unknown character position: ${position}`);
  }
}

function validateNation(nation) {
  if (!SOURCE_SCENE[nation]) throw new RangeError(`Unsupported nation: ${nation}`);
}

function copyCharacter(character) {
  return character ? { ...character } : null;
}

export function getCharacterSelectSceneConfig(nation) {
  validateNation(nation);
  return SOURCE_SCENE[nation];
}

export class CharacterSelectRuntime {
  constructor({ nation = Nation.ELMORAD } = {}) {
    validateNation(nation);
    this.nation = nation;
    this.scene = SOURCE_SCENE[nation];
    this.characters = [null, null, null];

    this.currentPosition = CharacterPosition.CENTER;
    this.destinationPosition = CharacterPosition.CENTER;
    this.process = CharacterSelectProcess.PRESELECT;
    this.selectedIndex = 0;

    this.cameraEye = clone3(this.scene.camera.eye);
    this.cameraEyeBackup = clone3(this.scene.camera.eye);
    this.lightTheta = 0;
    this.fadeAlpha = 0;
    this.fadeOutEnabled = false;
    this.uiEnabled = false;
    this.receivedCharacterSelect = false;

    this.lastAnimationCommand = null;
    this.pendingAction = null;
  }

  setCharacters(slots) {
    if (!Array.isArray(slots) || slots.length !== MAX_AVAILABLE_CHARACTER) {
      throw new RangeError(`Character slots must contain exactly ${MAX_AVAILABLE_CHARACTER} entries.`);
    }
    this.characters = slots.map(copyCharacter);
    this.uiEnabled = true;
    this.#queueAnimationForAll(SelectAnimation.PRE_SELECT, true, 0);
  }

  getCurrentIndex() {
    return slotIndexFromPosition(this.currentPosition);
  }

  getCurrentCharacter() {
    return this.characters[this.getCurrentIndex()];
  }

  requestLeft() {
    if (this.process === CharacterSelectProcess.ROTATING) return false;

    if (this.currentPosition === CharacterPosition.CENTER) {
      this.destinationPosition = CharacterPosition.LEFT;
      this.selectedIndex = 1;
    } else if (this.currentPosition === CharacterPosition.RIGHT) {
      this.destinationPosition = CharacterPosition.CENTER;
      this.selectedIndex = 0;
    } else {
      return false;
    }

    this.process = CharacterSelectProcess.ROTATING;
    this.pendingAction = { type: 'play-sound', id: 'ID_SOUND_CHR_SELECT_ROTATE' };
    return true;
  }

  requestRight() {
    if (this.process === CharacterSelectProcess.ROTATING) return false;

    if (this.currentPosition === CharacterPosition.CENTER) {
      this.destinationPosition = CharacterPosition.RIGHT;
      this.selectedIndex = 2;
    } else if (this.currentPosition === CharacterPosition.LEFT) {
      this.destinationPosition = CharacterPosition.CENTER;
      this.selectedIndex = 0;
    } else {
      return false;
    }

    this.process = CharacterSelectProcess.ROTATING;
    this.pendingAction = { type: 'play-sound', id: 'ID_SOUND_CHR_SELECT_ROTATE' };
    return true;
  }

  preselect(pointerInsideActiveRegion) {
    if (this.process !== CharacterSelectProcess.PRESELECT) return;

    const index = this.getCurrentIndex();
    if (this.characters[index]) {
      this.lastAnimationCommand = {
        slot: index,
        animation: pointerInsideActiveRegion ? SelectAnimation.PRE_SELECT : SelectAnimation.DUMMY,
        onceAndFreeze: true,
        blendSeconds: null,
      };
    }

    if (pointerInsideActiveRegion) {
      this.lightTheta = Math.min(
        this.scene.lightThetaMax,
        this.lightTheta + this.scene.lightThetaStepPerTick,
      );
    } else {
      this.lightTheta = Math.max(0, this.lightTheta - this.scene.lightThetaStepPerTick);
    }
  }

  selectOrCreate() {
    if (!this.uiEnabled || this.process === CharacterSelectProcess.ROTATING) return null;

    const index = this.getCurrentIndex();
    const character = this.characters[index];
    if (!character) {
      this.pendingAction = { type: 'create-character', slot: index };
      return this.pendingAction;
    }

    this.uiEnabled = false;
    this.pendingAction = {
      type: 'select-character-request',
      slot: index,
      characterId: character.id ?? character.szID ?? '',
      zone: character.zone ?? character.iZone ?? 1,
    };
    return this.pendingAction;
  }

  confirmCharacterSelection(success) {
    if (!success) {
      this.receivedCharacterSelect = false;
      this.uiEnabled = true;
      this.pendingAction = { type: 'character-select-failed' };
      return this.pendingAction;
    }

    const index = this.getCurrentIndex();
    if (!this.characters[index]) {
      throw new Error('Cannot confirm selection for an empty slot.');
    }

    this.process = CharacterSelectProcess.SELECTED;
    this.receivedCharacterSelect = true;
    this.uiEnabled = false;
    this.lightTheta = this.scene.lightThetaMax;
    this.lastAnimationCommand = {
      slot: index,
      animation: SelectAnimation.SELECTED,
      onceAndFreeze: true,
      blendSeconds: SELECTED_BLEND_SECONDS,
    };
    this.pendingAction = null;
    return this.lastAnimationCommand;
  }

  tick(deltaSeconds, { selectedAnimationEnded = false } = {}) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be a finite non-negative number.');
    }

    if (this.process === CharacterSelectProcess.ROTATING) {
      this.#tickRotation(deltaSeconds);
      return;
    }

    if (this.process === CharacterSelectProcess.SELECTED) {
      const index = this.getCurrentIndex();
      if (!selectedAnimationEnded) {
        this.lastAnimationCommand = {
          slot: index,
          animation: SelectAnimation.SELECTED,
          onceAndFreeze: true,
          blendSeconds: SELECTED_BLEND_SECONDS,
        };
        this.fadeOutEnabled = true;
        this.fadeAlpha = Math.min(255, this.fadeAlpha + FADE_ALPHA_PER_SECOND * deltaSeconds);
      } else {
        this.process = CharacterSelectProcess.COMPLETE;
        this.pendingAction = { type: 'enter-main', slot: index, character: copyCharacter(this.characters[index]) };
      }
    }
  }

  consumePendingAction() {
    const action = this.pendingAction;
    this.pendingAction = null;
    return action;
  }

  snapshot() {
    const index = this.getCurrentIndex();
    return {
      nation: this.nation,
      process: this.process,
      currentPosition: this.currentPosition,
      destinationPosition: this.destinationPosition,
      selectedIndex: this.selectedIndex,
      currentIndex: index,
      currentCharacter: copyCharacter(this.characters[index]),
      camera: {
        eye: clone3(this.cameraEye),
        at: clone3(this.scene.camera.at),
        up: clone3(this.scene.camera.up),
        near: this.scene.camera.near,
        far: this.scene.camera.far,
        fov: this.scene.camera.fov,
      },
      background: this.scene.background,
      lights: [...this.scene.lights],
      slotTransforms: this.scene.slots.map((slot) => ({
        position: clone3(slot.position),
        yawDegrees: slot.yawDegrees,
      })),
      lightTheta: this.lightTheta,
      fadeAlpha: this.fadeAlpha,
      fadeOutEnabled: this.fadeOutEnabled,
      uiEnabled: this.uiEnabled,
      receivedCharacterSelect: this.receivedCharacterSelect,
      lastAnimationCommand: this.lastAnimationCommand ? { ...this.lastAnimationCommand } : null,
    };
  }

  #queueAnimationForAll(animation, onceAndFreeze, blendSeconds) {
    const commands = [];
    for (let slot = 0; slot < this.characters.length; slot += 1) {
      if (this.characters[slot]) {
        commands.push({ slot, animation, onceAndFreeze, blendSeconds });
      }
    }
    this.lastAnimationCommand = commands.length ? { type: 'batch', commands } : null;
  }

  #rotateCamera(radians) {
    const offset = subtract3(this.cameraEye, this.scene.camera.at);
    this.cameraEye = add3(rotateY(offset, radians), this.scene.camera.at);
  }

  #dotFromBackupAfterPreview(previewRadians) {
    const offset = subtract3(this.cameraEye, this.scene.camera.at);
    const previewEye = add3(rotateY(offset, previewRadians), this.scene.camera.at);
    const v1 = normalize3(subtract3(this.cameraEyeBackup, this.scene.camera.at));
    const v2 = normalize3(subtract3(previewEye, this.scene.camera.at));
    return dot3(v1, v2);
  }

  #finishRotation(position, resetCamera = false) {
    if (resetCamera) this.cameraEye = clone3(this.cameraEyeBackup);
    this.currentPosition = position;
    this.process = CharacterSelectProcess.PRESELECT;
  }

  #tickRotation(deltaSeconds) {
    if (this.currentPosition === this.destinationPosition) return;

    if (this.currentPosition === CharacterPosition.CENTER) {
      if (this.destinationPosition === CharacterPosition.LEFT) {
        if (this.#dotFromBackupAfterPreview(0.01) < this.scene.rotateLeftDotThreshold) {
          this.#finishRotation(CharacterPosition.LEFT);
        } else {
          this.#rotateCamera(CAMERA_ROTATION_RADIANS_PER_SECOND * deltaSeconds);
        }
        return;
      }

      if (this.destinationPosition === CharacterPosition.RIGHT) {
        if (this.#dotFromBackupAfterPreview(-0.01) < this.scene.rotateRightDotThreshold) {
          this.#finishRotation(CharacterPosition.RIGHT);
        } else {
          this.#rotateCamera(-CAMERA_ROTATION_RADIANS_PER_SECOND * deltaSeconds);
        }
        return;
      }
    }

    if (this.currentPosition === CharacterPosition.LEFT && this.destinationPosition === CharacterPosition.CENTER) {
      if (this.cameraEye[0] <= 0) {
        this.#finishRotation(CharacterPosition.CENTER, true);
      } else {
        this.#rotateCamera(-CAMERA_ROTATION_RADIANS_PER_SECOND * deltaSeconds);
      }
      return;
    }

    if (this.currentPosition === CharacterPosition.RIGHT && this.destinationPosition === CharacterPosition.CENTER) {
      if (this.cameraEye[0] >= 0) {
        this.#finishRotation(CharacterPosition.CENTER, true);
      } else {
        this.#rotateCamera(CAMERA_ROTATION_RADIANS_PER_SECOND * deltaSeconds);
      }
    }
  }
}
