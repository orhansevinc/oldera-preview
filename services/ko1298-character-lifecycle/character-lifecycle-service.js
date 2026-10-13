'use strict';

const {
  CHARACTER_SLOTS_1298,
  MAX_CONFIRMATION_KEY_BYTES_1298,
  DeleteCode,
  LifecycleDomainError,
  LifecycleState
} = require('./contracts');

function requireFunction(object, method, dependencyName) {
  if (!object || typeof object[method] !== 'function') {
    throw new TypeError(`${dependencyName}.${method} must be a function`);
  }
}

function validateDependencies(deps) {
  requireFunction(deps.characterRepository, 'findOwnedCharacter', 'characterRepository');
  requireFunction(deps.characterRepository, 'runDeleteTransaction', 'characterRepository');
  requireFunction(deps.confirmationVerifier, 'verify', 'confirmationVerifier');
  requireFunction(deps.sessionGuard, 'getSelectedCharacterId', 'sessionGuard');
  requireFunction(deps.sessionGuard, 'isCharacterOnline', 'sessionGuard');
  requireFunction(deps.sessionGuard, 'runWithDeleteFence', 'sessionGuard');
  requireFunction(deps.inventoryCleanup, 'cleanupCharacterInventory', 'inventoryCleanup');
  requireFunction(deps.clanCleanup, 'cleanupCharacterMembership', 'clanCleanup');
  requireFunction(deps.friendCleanup, 'cleanupCharacterRelations', 'friendCleanup');
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LifecycleDomainError(DeleteCode.INVALID_REQUEST, `${field} is required`);
  }
}

function validateDeleteRequest(request) {
  if (!request || typeof request !== 'object') {
    throw new LifecycleDomainError(DeleteCode.INVALID_REQUEST, 'request is required');
  }

  assertNonEmptyString(request.accountId, 'accountId');
  assertNonEmptyString(request.characterId, 'characterId');
  assertNonEmptyString(request.confirmationKey, 'confirmationKey');

  if (!CHARACTER_SLOTS_1298.includes(request.slotIndex)) {
    throw new LifecycleDomainError(DeleteCode.INVALID_REQUEST, 'slotIndex must be 0, 1, or 2');
  }

  const keyBytes = Buffer.byteLength(request.confirmationKey, 'utf8');
  if (keyBytes < 1 || keyBytes > MAX_CONFIRMATION_KEY_BYTES_1298) {
    throw new LifecycleDomainError(
      DeleteCode.INVALID_REQUEST,
      `confirmationKey must be 1-${MAX_CONFIRMATION_KEY_BYTES_1298} bytes for the 1298 client`
    );
  }
}

class CharacterLifecycleService {
  constructor(deps) {
    validateDependencies(deps);
    this.characterRepository = deps.characterRepository;
    this.confirmationVerifier = deps.confirmationVerifier;
    this.sessionGuard = deps.sessionGuard;
    this.inventoryCleanup = deps.inventoryCleanup;
    this.clanCleanup = deps.clanCleanup;
    this.friendCleanup = deps.friendCleanup;
    this.clock = deps.clock || (() => new Date());
    this.eventIdFactory = deps.eventIdFactory || (() => `char-delete-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  async deleteCharacter(request) {
    validateDeleteRequest(request);

    const character = await this.characterRepository.findOwnedCharacter({
      accountId: request.accountId,
      characterId: request.characterId,
      slotIndex: request.slotIndex
    });

    if (!character) {
      throw new LifecycleDomainError(DeleteCode.NOT_OWNED, 'character is not owned by the account/slot');
    }

    await this.#assertNotSelectedOrOnline(request.accountId, character.id);

    const confirmationOk = await this.confirmationVerifier.verify({
      accountId: request.accountId,
      characterId: character.id,
      confirmationKey: request.confirmationKey
    });

    if (!confirmationOk) {
      throw new LifecycleDomainError(DeleteCode.CONFIRMATION_FAILED, 'delete confirmation failed');
    }

    return this.sessionGuard.runWithDeleteFence(
      { accountId: request.accountId, characterId: character.id },
      async () => {
        await this.#assertNotSelectedOrOnline(request.accountId, character.id);

        try {
          return await this.characterRepository.runDeleteTransaction(
            { accountId: request.accountId, characterId: character.id },
            async (unitOfWork) => {
              requireFunction(unitOfWork, 'lockOwnedCharacter', 'unitOfWork');
              requireFunction(unitOfWork, 'setLifecycleState', 'unitOfWork');
              requireFunction(unitOfWork, 'releaseCharacterName', 'unitOfWork');
              requireFunction(unitOfWork, 'deleteCharacter', 'unitOfWork');
              requireFunction(unitOfWork, 'appendAuditEvent', 'unitOfWork');

              const locked = await unitOfWork.lockOwnedCharacter({
                accountId: request.accountId,
                characterId: character.id,
                slotIndex: request.slotIndex
              });

              if (!locked) {
                throw new LifecycleDomainError(DeleteCode.DELETE_CONFLICT, 'character changed before delete commit');
              }

              await unitOfWork.setLifecycleState({
                characterId: character.id,
                state: LifecycleState.DELETE_IN_PROGRESS
              });

              await this.inventoryCleanup.cleanupCharacterInventory({
                accountId: request.accountId,
                character,
                unitOfWork
              });

              await this.clanCleanup.cleanupCharacterMembership({
                accountId: request.accountId,
                character,
                unitOfWork
              });

              await this.friendCleanup.cleanupCharacterRelations({
                accountId: request.accountId,
                character,
                unitOfWork
              });

              await unitOfWork.releaseCharacterName({
                characterId: character.id,
                name: character.name || character.id
              });

              await unitOfWork.deleteCharacter({
                accountId: request.accountId,
                characterId: character.id,
                slotIndex: request.slotIndex
              });

              const auditEvent = {
                eventId: this.eventIdFactory(),
                type: 'character.deleted',
                occurredAt: this.clock().toISOString(),
                accountId: request.accountId,
                characterId: character.id,
                characterName: character.name || character.id,
                slotIndex: request.slotIndex,
                previousState: character.lifecycleState || LifecycleState.ACTIVE,
                finalState: LifecycleState.DELETED,
                nameReleased: true,
                accountScopedInnPreserved: true,
                confirmationSecretRecorded: false
              };

              await unitOfWork.appendAuditEvent(auditEvent);

              return {
                code: DeleteCode.DELETED,
                characterId: character.id,
                slotIndex: request.slotIndex,
                lifecycleState: LifecycleState.DELETED,
                nameReleased: true
              };
            }
          );
        } catch (error) {
          if (error instanceof LifecycleDomainError) {
            throw error;
          }
          throw new LifecycleDomainError(DeleteCode.DELETE_FAILED, 'atomic character delete failed and must roll back', {
            cause: error && error.message ? error.message : String(error)
          });
        }
      }
    );
  }

  async #assertNotSelectedOrOnline(accountId, characterId) {
    const selectedCharacterId = await this.sessionGuard.getSelectedCharacterId(accountId);
    if (selectedCharacterId === characterId) {
      throw new LifecycleDomainError(DeleteCode.CHARACTER_SELECTED, 'selected character cannot be deleted');
    }

    if (await this.sessionGuard.isCharacterOnline(characterId)) {
      throw new LifecycleDomainError(DeleteCode.CHARACTER_ONLINE, 'online character cannot be deleted');
    }
  }
}

module.exports = {
  CharacterLifecycleService,
  validateDeleteRequest
};
