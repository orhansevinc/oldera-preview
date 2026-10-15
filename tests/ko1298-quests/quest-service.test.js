'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  QuestError,
  QuestStatus,
  InMemoryQuestStateRepository,
  InMemoryRewardGateway,
  QuestService,
  EventScriptExecutor,
  NpcEventRouter,
  validateEventDefinition,
  loadQuestData
} = require('../../services/ko1298-quests/src');

async function fixture() {
  const data = await loadQuestData(path.join(__dirname, '../../quest-data/fixtures'));
  const repository = new InMemoryQuestStateRepository();
  const rewardGateway = new InMemoryRewardGateway();
  const questService = new QuestService({ definitions: data.quests, repository, rewardGateway });
  const executor = new EventScriptExecutor({ questService });
  const router = new NpcEventRouter({ routes: data.routes, events: data.events, executor });
  return { data, repository, rewardGateway, questService, router };
}

test('requirements enforce level, class, nation and prerequisite completion', async () => {
  const { questService } = await fixture();
  let gate = await questService.eligibility('c1', 'fixture.restricted_training', { level: 9, classId: 'fixture.mage', nationId: 'fixture.elmo' });
  assert.equal(gate.eligible, false);
  assert.deepEqual(gate.reasons.map((r) => r.code), ['MIN_LEVEL', 'CLASS', 'NATION']);

  gate = await questService.eligibility('c1', 'fixture.repeatable_errand', { level: 80 });
  assert.equal(gate.eligible, false);
  assert.equal(gate.reasons[0].code, 'PREREQUISITE');
});

test('accept, progress and complete grant one idempotent reward bundle', async () => {
  const { questService, rewardGateway } = await fixture();
  const characterId = 'c2';
  const accepted = await questService.accept(characterId, 'fixture.first_steps', { level: 1 });
  assert.equal(accepted.status, QuestStatus.ACTIVE);
  assert.equal(accepted.run, 1);

  const progressed = await questService.recordProgress(characterId, 'fixture.first_steps', { type: 'npc_talk', targetId: 'fixture.guide' });
  assert.equal(progressed.objectiveProgress.talk_to_guide, 1);

  const completed = await questService.complete(characterId, 'fixture.first_steps');
  assert.equal(completed.status, QuestStatus.COMPLETED);
  assert.equal(completed.completionCount, 1);
  assert.equal(rewardGateway.grants.size, 1);
  const grant = [...rewardGateway.grants.values()][0];
  assert.equal(grant.rewards.xp, 100);
  assert.equal(grant.rewards.coins, 50);
  assert.deepEqual(grant.rewards.items, [{ itemId: 'fixture.token', count: 1 }]);
});

test('non-repeatable quest cannot be accepted after completion', async () => {
  const { questService } = await fixture();
  await questService.accept('c3', 'fixture.first_steps', { level: 1 });
  await questService.recordProgress('c3', 'fixture.first_steps', { type: 'npc_talk', targetId: 'fixture.guide' });
  await questService.complete('c3', 'fixture.first_steps');
  await assert.rejects(() => questService.accept('c3', 'fixture.first_steps', { level: 1 }), (error) => error instanceof QuestError && error.code === 'QUEST_NOT_ELIGIBLE');
});

test('repeatable quest starts a fresh run after each completion', async () => {
  const { questService } = await fixture();
  await questService.accept('c4', 'fixture.first_steps', { level: 1 });
  await questService.recordProgress('c4', 'fixture.first_steps', { type: 'npc_talk', targetId: 'fixture.guide' });
  await questService.complete('c4', 'fixture.first_steps');

  const first = await questService.accept('c4', 'fixture.repeatable_errand', { level: 1 });
  assert.equal(first.run, 1);
  await questService.recordProgress('c4', 'fixture.repeatable_errand', { type: 'npc_defeated', targetId: 'fixture.worm', count: 3 });
  await questService.complete('c4', 'fixture.repeatable_errand');
  const second = await questService.accept('c4', 'fixture.repeatable_errand', { level: 1 });
  assert.equal(second.run, 2);
  assert.deepEqual(second.objectiveProgress, {});
});

test('abandon works only when the definition explicitly allows it', async () => {
  const { questService } = await fixture();
  await questService.accept('c5', 'fixture.first_steps', { level: 1 });
  const abandoned = await questService.abandon('c5', 'fixture.first_steps');
  assert.equal(abandoned.status, QuestStatus.NOT_STARTED);

  await questService.accept('c6', 'fixture.restricted_training', { level: 10, classId: 'fixture.warrior', nationId: 'fixture.karus' });
  await assert.rejects(() => questService.abandon('c6', 'fixture.restricted_training'), (error) => error.code === 'ABANDON_NOT_ALLOWED');
});

test('concurrent progress is serialized and capped at requiredCount', async () => {
  const { questService } = await fixture();
  await questService.accept('c7', 'fixture.first_steps', { level: 1 });
  await Promise.all(Array.from({ length: 20 }, () => questService.recordProgress('c7', 'fixture.first_steps', { type: 'npc_talk', targetId: 'fixture.guide' })));
  const view = await questService.view('c7', 'fixture.first_steps', { level: 1 });
  assert.equal(view.state.objectiveProgress.talk_to_guide, 1);
  assert.equal(view.ready, true);
});

test('reward failure leaves quest active for safe retry', async () => {
  const data = await loadQuestData(path.join(__dirname, '../../quest-data/fixtures'));
  const repository = new InMemoryQuestStateRepository();
  const rewardGateway = { async grantBundle() { throw new Error('downstream unavailable'); } };
  const questService = new QuestService({ definitions: data.quests, repository, rewardGateway });
  await questService.accept('c8', 'fixture.first_steps', { level: 1 });
  await questService.recordProgress('c8', 'fixture.first_steps', { type: 'npc_talk', targetId: 'fixture.guide' });
  await assert.rejects(() => questService.complete('c8', 'fixture.first_steps'), /downstream unavailable/);
  const state = await repository.get('c8', 'fixture.first_steps');
  assert.equal(state.status, QuestStatus.ACTIVE);
  assert.equal(state.completionCount, 0);
});

test('NPC interaction routes to deterministic event output', async () => {
  const { router } = await fixture();
  const result = await router.route({ npcId: 'fixture.guide', action: 'interact', characterId: 'c9', player: { level: 1 } });
  assert.equal(result.handled, true);
  assert.equal(result.output[0].type, 'dialogue');
  assert.equal(result.output[1].type, 'quest_view');
  assert.equal(result.output[1].view.dialogueState, 'available');
});

test('unknown event operations are rejected; script budget stops loops', async () => {
  assert.throws(() => validateEventDefinition({ id: 'bad', script: [{ op: 'exec_os', command: 'rm -rf /' }] }), (error) => error.code === 'INVALID_EVENT');

  const { questService } = await fixture();
  const executor = new EventScriptExecutor({ questService, maxInstructions: 4 });
  const loop = {
    id: 'loop',
    script: [
      { op: 'goto_if_state', questId: 'fixture.first_steps', states: ['not_started'], target: 0 },
      { op: 'end' }
    ]
  };
  await assert.rejects(() => executor.execute(loop, { characterId: 'c10', player: { level: 1 } }), (error) => error.code === 'SCRIPT_BUDGET_EXCEEDED');
});
