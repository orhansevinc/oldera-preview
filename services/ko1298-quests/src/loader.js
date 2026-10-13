'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { QuestError } = require('./errors');
const { validateQuestDefinition } = require('./model');
const { validateEventDefinition } = require('./events');

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new QuestError('INVALID_JSON', `Invalid JSON in ${filePath}`, { cause: error.message });
  }
}

async function loadQuestData(directory) {
  const questsRaw = await readJson(path.join(directory, 'quests.json'));
  const eventsRaw = await readJson(path.join(directory, 'events.json'));
  const routesRaw = await readJson(path.join(directory, 'routes.json'));

  if (!Array.isArray(questsRaw) || !Array.isArray(eventsRaw) || !Array.isArray(routesRaw)) {
    throw new QuestError('INVALID_DATASET', 'quests.json, events.json and routes.json must each contain an array');
  }

  return {
    quests: questsRaw.map(validateQuestDefinition),
    events: eventsRaw.map(validateEventDefinition),
    routes: routesRaw
  };
}

module.exports = { loadQuestData };
