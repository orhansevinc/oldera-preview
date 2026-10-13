'use strict';

const { ValidationError, ServiceUnavailableError } = require('./errors');
const { InMemoryIdempotencyStore } = require('./idempotency');

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const META_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const FORBIDDEN_META_RE = /(password|passwd|secret|token|authorization|cookie)/i;

function nowIso(now) { return new Date(now()).toISOString(); }

function validateActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) throw new ValidationError('actor is required');
  if (typeof actor.id !== 'string' || !actor.id.trim() || actor.id.length > 128) throw new ValidationError('actor.id is invalid');
  if (!['user', 'service'].includes(actor.type)) throw new ValidationError('actor.type must be user or service');
  if (!Array.isArray(actor.roles) || actor.roles.length === 0 || actor.roles.some((r) => typeof r !== 'string' || !r || r.length > 64)) {
    throw new ValidationError('actor.roles must contain at least one valid role');
  }
  if (typeof actor.authnMethod !== 'string' || !actor.authnMethod || actor.authnMethod.length > 64) throw new ValidationError('actor.authnMethod is invalid');
  if (actor.sessionId !== undefined && (typeof actor.sessionId !== 'string' || !actor.sessionId || actor.sessionId.length > 128)) {
    throw new ValidationError('actor.sessionId is invalid');
  }
  return Object.freeze({
    id: actor.id.trim(),
    type: actor.type,
    roles: Object.freeze([...actor.roles]),
    authnMethod: actor.authnMethod,
    sessionId: actor.sessionId,
  });
}

function validateMetadata(metadata) {
  if (metadata === undefined) return Object.freeze({});
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new ValidationError('metadata must be an object');
  const entries = Object.entries(metadata);
  if (entries.length > 20) throw new ValidationError('metadata may contain at most 20 fields');
  const out = {};
  for (const [key, value] of entries) {
    if (!META_KEY_RE.test(key) || FORBIDDEN_META_RE.test(key)) throw new ValidationError(`metadata key is not allowed: ${key}`);
    if (!['string', 'number', 'boolean'].includes(typeof value)) throw new ValidationError(`metadata value for ${key} must be scalar`);
    if (String(value).length > 256) throw new ValidationError(`metadata value for ${key} is too long`);
    out[key] = value;
  }
  return Object.freeze(out);
}

function validateEnvelope(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new ValidationError('request must be an object');
  if (typeof request.requestId !== 'string' || !REQUEST_ID_RE.test(request.requestId)) {
    throw new ValidationError('requestId must be 8-128 safe characters');
  }
  if (typeof request.command !== 'string' || request.command.length > 128) throw new ValidationError('command is invalid');
  if (typeof request.reason !== 'string' || request.reason.trim().length < 5 || request.reason.length > 500) {
    throw new ValidationError('reason must be 5-500 characters');
  }
  if (request.dryRun !== undefined && typeof request.dryRun !== 'boolean') throw new ValidationError('dryRun must be boolean');
  return {
    requestId: request.requestId,
    command: request.command,
    reason: request.reason.trim(),
    dryRun: request.dryRun === true,
    actor: validateActor(request.actor),
    metadata: validateMetadata(request.metadata),
    args: request.args === undefined ? {} : request.args,
  };
}

function failed(base, code, message, data) {
  return Object.freeze({ ...base, status: 'failed', code, message, ...(data === undefined ? {} : { data }) });
}

function success(base, dryRun, data) {
  return Object.freeze({
    ...base,
    status: dryRun ? 'dry-run' : 'ok',
    code: dryRun ? 'DRY_RUN_OK' : 'OK',
    message: dryRun ? 'Command validated in dry-run mode' : 'Command executed',
    ...(data === undefined ? {} : { data }),
  });
}

async function callWithTimeout(handler, context, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => handler({ ...context, signal: controller.signal })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error(`Command timed out after ${timeoutMs}ms`);
          error.code = 'TIMEOUT';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class CommandBus {
  constructor({ registry, authorizer, auditSink, idempotencyStore, timeoutMs = DEFAULT_TIMEOUT_MS, idempotencyTtlMs = DEFAULT_IDEMPOTENCY_TTL_MS, now = () => Date.now() }) {
    if (!(registry instanceof Map)) throw new TypeError('registry must be a Map');
    if (!authorizer || typeof authorizer.authorize !== 'function') throw new TypeError('authorizer.authorize is required');
    if (!auditSink || typeof auditSink.append !== 'function') throw new TypeError('auditSink.append is required');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 30000) throw new TypeError('timeoutMs must be 50-30000');
    this.registry = registry;
    this.authorizer = authorizer;
    this.auditSink = auditSink;
    this.idempotencyStore = idempotencyStore || new InMemoryIdempotencyStore({ now });
    this.timeoutMs = timeoutMs;
    this.idempotencyTtlMs = idempotencyTtlMs;
    this.now = now;
  }

  async execute(rawRequest) {
    let request;
    try {
      request = validateEnvelope(rawRequest);
    } catch (error) {
      return failed({ requestId: rawRequest && rawRequest.requestId || null, command: rawRequest && rawRequest.command || null }, error.code || 'VALIDATION_ERROR', error.message);
    }

    const def = this.registry.get(request.command);
    const base = { requestId: request.requestId, command: request.command };
    if (!def) return failed(base, 'COMMAND_NOT_ALLOWED', 'Command is not in the server-side allowlist');
    if (request.dryRun && !def.supportsDryRun) return failed(base, 'DRY_RUN_UNSUPPORTED', 'This command does not support dry-run');

    let args;
    try {
      args = def.validateArgs(request.args);
    } catch (error) {
      return failed(base, error.code || 'VALIDATION_ERROR', error.message);
    }
    const target = def.target(args);

    let decision;
    try {
      decision = await this.authorizer.authorize({
        actor: request.actor,
        permission: def.permission,
        command: def.id,
        risk: def.risk,
        target,
        reason: request.reason,
        requestId: request.requestId,
        metadata: request.metadata,
      });
    } catch (error) {
      return failed(base, 'AUTHORIZATION_UNAVAILABLE', 'Authorization service unavailable');
    }
    if (!decision || decision.allowed !== true) {
      return failed(base, 'FORBIDDEN', decision && decision.reason ? String(decision.reason) : 'Actor is not authorized');
    }

    const idempotencyKey = `${request.actor.id}:${request.requestId}:${def.id}`;
    try {
      const { value, replayed } = await this.idempotencyStore.run(idempotencyKey, this.idempotencyTtlMs, async () => {
        return this.#executeOnce({ request, def, args, target, base });
      });
      if (!replayed) return value;

      const replay = Object.freeze({ ...value, idempotentReplay: true });
      try {
        await this.auditSink.append({
          event: 'command.idempotent_replay',
          at: nowIso(this.now),
          requestId: request.requestId,
          command: def.id,
          actor: request.actor,
          target,
          reason: request.reason,
          metadata: request.metadata,
          result: { status: replay.status, code: replay.code },
        });
      } catch (_) {
        // Replay is already backed by the original audit trail; do not re-execute the command.
      }
      return replay;
    } catch (error) {
      return failed(base, 'IDEMPOTENCY_UNAVAILABLE', 'Idempotency service unavailable');
    }
  }

  async #executeOnce({ request, def, args, target, base }) {
    const started = this.now();
    const commonAudit = {
      requestId: request.requestId,
      command: def.id,
      risk: def.risk,
      permission: def.permission,
      actor: request.actor,
      target,
      reason: request.reason,
      dryRun: request.dryRun,
      metadata: request.metadata,
    };

    try {
      await this.auditSink.append({ event: 'command.accepted', at: nowIso(this.now), ...commonAudit });
    } catch (_) {
      return failed(base, 'AUDIT_UNAVAILABLE', 'Audit sink unavailable; command was not executed');
    }

    const context = {
      requestId: request.requestId,
      actor: request.actor,
      reason: request.reason,
      metadata: request.metadata,
      args,
      target,
      dryRun: request.dryRun,
    };

    let result;
    try {
      const handler = request.dryRun ? def.dryRun : def.execute;
      const data = await callWithTimeout(handler, context, this.timeoutMs);
      result = success(base, request.dryRun, data);
    } catch (error) {
      if (error && error.code === 'TIMEOUT') result = failed(base, 'TIMEOUT', error.message);
      else if (error instanceof ServiceUnavailableError || error && error.code === 'SERVICE_UNAVAILABLE') {
        result = failed(base, 'SERVICE_UNAVAILABLE', error.message || 'Required service unavailable', error.details);
      } else {
        result = failed(base, 'EXECUTION_FAILED', 'Command execution failed');
      }
    }

    const finished = this.now();
    try {
      await this.auditSink.append({
        event: 'command.completed',
        at: nowIso(this.now),
        durationMs: Math.max(0, finished - started),
        ...commonAudit,
        result: { status: result.status, code: result.code },
      });
      return result;
    } catch (_) {
      if (result.status === 'ok' || result.status === 'dry-run') {
        return Object.freeze({ ...result, code: result.status === 'dry-run' ? 'DRY_RUN_OK_AUDIT_DEGRADED' : 'OK_AUDIT_DEGRADED', auditDegraded: true });
      }
      return Object.freeze({ ...result, auditDegraded: true });
    }
  }
}

module.exports = {
  CommandBus,
  validateEnvelope,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_IDEMPOTENCY_TTL_MS,
};
