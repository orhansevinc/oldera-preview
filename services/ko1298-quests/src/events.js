'use strict';

const { QuestError } = require('./errors');
const { ScriptOp, QuestStatus, isOpaqueId } = require('./model');

const ALLOWED_OPS = new Set(Object.values(ScriptOp));

function validateEventDefinition(event) {
  if (!event || !isOpaqueId(event.id)) throw new QuestError('INVALID_EVENT', 'event id is required');
  if (!Array.isArray(event.script) || event.script.length === 0) throw new QuestError('INVALID_EVENT', 'event script must be a non-empty array');

  event.script.forEach((instruction, index) => {
    if (!instruction || typeof instruction !== 'object') throw new QuestError('INVALID_EVENT', `instruction ${index} must be an object`);
    if (!ALLOWED_OPS.has(instruction.op)) throw new QuestError('INVALID_EVENT', `instruction ${index} uses unsupported op: ${String(instruction.op)}`);
    if ([ScriptOp.QUEST_VIEW, ScriptOp.QUEST_ACCEPT, ScriptOp.QUEST_COMPLETE, ScriptOp.QUEST_ABANDON, ScriptOp.GOTO_IF_STATE].includes(instruction.op)) {
      if (!isOpaqueId(instruction.questId)) throw new QuestError('INVALID_EVENT', `instruction ${index} requires questId`);
    }
    if (instruction.op === ScriptOp.DIALOGUE && (typeof instruction.key !== 'string' || instruction.key.length === 0)) {
      throw new QuestError('INVALID_EVENT', `instruction ${index} requires dialogue key`);
    }
    if (instruction.op === ScriptOp.GOTO_IF_STATE) {
      if (!Array.isArray(instruction.states) || instruction.states.some((state) => !Object.values(QuestStatus).includes(state))) {
        throw new QuestError('INVALID_EVENT', `instruction ${index} has invalid states`);
      }
      if (!Number.isInteger(instruction.target) || instruction.target < 0 || instruction.target >= event.script.length) {
        throw new QuestError('INVALID_EVENT', `instruction ${index} has invalid target`);
      }
    }
  });

  return Object.freeze({ ...event, script: Object.freeze(event.script.map((instruction) => Object.freeze({ ...instruction }))) });
}

class EventScriptExecutor {
  constructor({ questService, maxInstructions = 64 }) {
    this.questService = questService;
    this.maxInstructions = maxInstructions;
  }

  async execute(event, context) {
    const definition = validateEventDefinition(event);
    if (!context || context.characterId === undefined) throw new QuestError('INVALID_EVENT_CONTEXT', 'characterId is required');
    const output = [];
    let pc = 0;
    let executed = 0;

    while (pc < definition.script.length) {
      executed += 1;
      if (executed > this.maxInstructions) throw new QuestError('SCRIPT_BUDGET_EXCEEDED', `Event ${String(definition.id)} exceeded instruction budget`);
      const instruction = definition.script[pc];

      switch (instruction.op) {
        case ScriptOp.DIALOGUE:
          output.push({ type: 'dialogue', key: instruction.key });
          pc += 1;
          break;
        case ScriptOp.QUEST_VIEW: {
          const view = await this.questService.view(context.characterId, instruction.questId, context.player || {});
          output.push({ type: 'quest_view', questId: instruction.questId, view });
          pc += 1;
          break;
        }
        case ScriptOp.QUEST_ACCEPT: {
          const state = await this.questService.accept(context.characterId, instruction.questId, context.player || {});
          output.push({ type: 'quest_accepted', questId: instruction.questId, state });
          pc += 1;
          break;
        }
        case ScriptOp.QUEST_COMPLETE: {
          const state = await this.questService.complete(context.characterId, instruction.questId);
          output.push({ type: 'quest_completed', questId: instruction.questId, state });
          pc += 1;
          break;
        }
        case ScriptOp.QUEST_ABANDON: {
          const state = await this.questService.abandon(context.characterId, instruction.questId);
          output.push({ type: 'quest_abandoned', questId: instruction.questId, state });
          pc += 1;
          break;
        }
        case ScriptOp.GOTO_IF_STATE: {
          const state = await this.questService.repository.get(context.characterId, instruction.questId);
          pc = instruction.states.includes(state.status) ? instruction.target : pc + 1;
          break;
        }
        case ScriptOp.END:
          return output;
        default:
          throw new QuestError('UNREACHABLE_SCRIPT_OP', `Unsupported event operation: ${String(instruction.op)}`);
      }
    }

    return output;
  }
}

class NpcEventRouter {
  constructor({ routes, events, executor }) {
    this.executor = executor;
    this.events = new Map();
    this.routes = new Map();

    for (const event of events || []) {
      const validated = validateEventDefinition(event);
      const key = String(validated.id);
      if (this.events.has(key)) throw new QuestError('DUPLICATE_EVENT', `Duplicate event id: ${key}`);
      this.events.set(key, validated);
    }

    for (const route of routes || []) {
      if (!route || !isOpaqueId(route.npcId) || typeof route.action !== 'string' || route.action.length === 0 || !isOpaqueId(route.eventId)) {
        throw new QuestError('INVALID_ROUTE', 'route requires npcId, action and eventId');
      }
      if (!this.events.has(String(route.eventId))) throw new QuestError('INVALID_ROUTE', `route references unknown event: ${String(route.eventId)}`);
      const key = this._key(route.npcId, route.action);
      if (this.routes.has(key)) throw new QuestError('DUPLICATE_ROUTE', `Duplicate NPC event route: ${key}`);
      this.routes.set(key, String(route.eventId));
    }
  }

  _key(npcId, action) {
    return `${String(npcId)}\u0000${String(action)}`;
  }

  async route({ npcId, action = 'interact', characterId, player = {} }) {
    const eventId = this.routes.get(this._key(npcId, action));
    if (!eventId) return { handled: false, output: [] };
    const event = this.events.get(eventId);
    const output = await this.executor.execute(event, { characterId, player, npcId, action });
    return { handled: true, eventId: event.id, output };
  }
}

module.exports = { validateEventDefinition, EventScriptExecutor, NpcEventRouter };
