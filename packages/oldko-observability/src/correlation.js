import { createHash, randomUUID } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,160}$/;

function safeId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  return SAFE_ID.test(text) ? text : undefined;
}

export function hashAccountCorrelation(accountId, { releaseId = 'unknown-release', namespace = 'oldkoweb-account-correlation' } = {}) {
  if (accountId === undefined || accountId === null || String(accountId).length === 0) return undefined;
  return createHash('sha256')
    .update(`${namespace}\0${releaseId}\0${String(accountId)}`)
    .digest('hex');
}

export function createDiagnosticCorrelation(input = {}) {
  const requestId = safeId(input.request_id ?? input.requestId) ?? randomUUID();
  const traceId = safeId(input.trace_id ?? input.traceId) ?? requestId;
  const releaseId = safeId(input.release_id ?? input.releaseId) ?? 'unknown-release';
  const accountHash = safeId(input.account_hash ?? input.accountHash) ?? hashAccountCorrelation(input.account_id ?? input.accountId, { releaseId });

  return Object.freeze({
    request_id: requestId,
    trace_id: traceId,
    ...(safeId(input.session_ref ?? input.sessionRef ?? input.session_id ?? input.sessionId) ? { session_ref: safeId(input.session_ref ?? input.sessionRef ?? input.session_id ?? input.sessionId) } : {}),
    ...(accountHash ? { account_hash: accountHash } : {}),
    ...(safeId(input.character_id ?? input.characterId) ? { character_id: safeId(input.character_id ?? input.characterId) } : {}),
    ...(safeId(input.game_connection_id ?? input.gameConnectionId) ? { game_connection_id: safeId(input.game_connection_id ?? input.gameConnectionId) } : {}),
    ...(safeId(input.runtime_target_id ?? input.runtimeTargetId) ? { runtime_target_id: safeId(input.runtime_target_id ?? input.runtimeTargetId) } : {}),
    ...(safeId(input.admin_command_id ?? input.adminCommandId) ? { admin_command_id: safeId(input.admin_command_id ?? input.adminCommandId) } : {})
  });
}

export const FLOW_STAGES = Object.freeze({
  account_to_game: Object.freeze(['website', 'account_api', 'postgresql', 'game_auth', 'game_session', 'character', 'world_ready']),
  combat: Object.freeze(['mob_visibility', 'target', 'attack', 'slash', 'hp', 'death']),
  admin_command: Object.freeze(['admin_login', 'command_enqueue', 'downstream', 'terminal_status'])
});

export function makeFlowEvent(flow, stage, correlation, fields = {}) {
  if (!FLOW_STAGES[flow]?.includes(stage)) throw new TypeError(`Unknown flow stage: ${flow}/${stage}`);
  return {
    event: 'domain_live_flow',
    flow,
    stage,
    ...createDiagnosticCorrelation(correlation),
    ...fields
  };
}
