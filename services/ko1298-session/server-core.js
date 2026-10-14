'use strict';

const net = require('node:net');
const { FrameDecoder, frame } = require('./protocol');
const { MemoryRepository } = require('./repository');
const { AuthSession, GameSession } = require('./session');
const { SessionDispatcher } = require('./dispatcher');
const { SessionError, ERROR_CATEGORY, classifyError, safeErrorMetadata } = require('./errors');

class SocketIdPool {
  constructor() {
    this.next = 1;
    this.active = new Set();
  }

  allocate() {
    for (let attempts = 0; attempts < 0xffff; attempts += 1) {
      const candidate = this.next;
      this.next = this.next >= 0xffff ? 1 : this.next + 1;
      if (!this.active.has(candidate)) {
        this.active.add(candidate);
        return candidate;
      }
    }
    throw new SessionError('SOCKET_ID_EXHAUSTED', 'no free uint16 game socket id remains', {
      category: ERROR_CATEGORY.TRANSPORT,
      fatal: true,
    });
  }

  release(socketId) {
    return this.active.delete(socketId);
  }
}

const defaultSocketIds = new SocketIdPool();

function tryLoadWorldSession(repository) {
  try {
    const { WorldSessionService } = require('../ko1298-world');
    return new WorldSessionService({ repository });
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes('ko1298-world')) return null;
    throw error;
  }
}

function allocateSocketId() {
  return defaultSocketIds.allocate();
}

function releaseSocketId(socketId) {
  return defaultSocketIds.release(socketId);
}

function createLogger({ name = 'ko1298-session', packetTrace = process.env.PACKET_TRACE === '1', sink = console } = {}) {
  const write = (level, event, metadata = {}) => {
    const entry = { service: name, level, event, ...sanitizeLogMetadata(metadata) };
    const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
    sink?.[method]?.(JSON.stringify(entry));
  };
  return {
    info: (event, metadata) => write('info', event, metadata),
    warn: (event, metadata) => write('warn', event, metadata),
    error: (event, metadata) => write('error', event, metadata),
    packet(direction, packet, metadata = {}) {
      if (!packetTrace) return;
      const p = Buffer.from(packet || []);
      write('info', 'packet_trace', { direction, opcode: p.length ? p[0] : null, length: p.length, ...metadata });
    },
    session(event, metadata) {
      write(event.includes('error') || event.includes('rejected') ? 'warn' : 'info', event, metadata);
    },
  };
}

function listen(port, makeSession, name, {
  logger = createLogger({ name: `ko1298-${name}` }),
  socketIds = defaultSocketIds,
  dispatcherOptions = {},
  sessionAuthority = null,
} = {}) {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    const socketId = name === 'game' ? socketIds.allocate() : 0;
    const session = makeSession({
      socketId,
      logger: (event, metadata) => logger.session(event, metadata),
    });
    const dispatcher = new SessionDispatcher(session, dispatcherOptions);
    let transportChain = Promise.resolve();
    let terminating = false;
    let released = false;

    if (name === 'game' && sessionAuthority) {
      if (typeof sessionAuthority.register !== 'function' || typeof sessionAuthority.unregister !== 'function') {
        throw new TypeError('sessionAuthority must expose register() and unregister()');
      }
      sessionAuthority.register({
        socketId,
        session,
        dispatcher,
        disconnectTransport: () => { if (!socket.destroyed) socket.destroy(); },
      });
    }

    const release = () => {
      if (!released && name === 'game') {
        released = true;
        sessionAuthority?.unregister?.(socketId);
        socketIds.release(socketId);
      }
    };

    const terminate = async (error, { reason = null, useGrace = true } = {}) => {
      if (terminating) return;
      terminating = true;
      const classified = classifyError(error, 'TRANSPORT_FAILURE');
      logger.error('session_failure', { socketId, ...safeErrorMetadata(classified) });
      try {
        await dispatcher.close({ reason: reason || classified.code, useGrace });
      } catch (cleanupError) {
        logger.error('session_cleanup_failure', { socketId, ...safeErrorMetadata(cleanupError) });
      }
      if (!socket.destroyed) socket.destroy();
    };

    socket.on('data', (chunk) => {
      if (terminating) return;
      socket.pause();
      transportChain = transportChain.then(async () => {
        let payloads;
        try {
          payloads = decoder.push(chunk);
        } catch (error) {
          throw new SessionError('MALFORMED_FRAME', error.message, {
            category: ERROR_CATEGORY.MALFORMED_PACKET,
            fatal: true,
            details: { socketId, chunkLength: chunk.length },
            cause: error,
          });
        }
        for (const payload of payloads) {
          logger.packet('in', payload, { socketId, state: session.phase || null });
          const responses = await dispatcher.enqueue(payload);
          if (socket.destroyed || terminating) break;
          for (const response of responses || []) {
            logger.packet('out', response, { socketId, state: session.phase || null });
            socket.write(frame(response));
          }
        }
      }).catch((error) => terminate(error)).finally(() => {
        if (!socket.destroyed && !terminating) socket.resume();
      });
    });

    socket.on('error', (error) => {
      logger.warn('socket_error', { socketId, code: error?.code || 'SOCKET_ERROR' });
    });

    socket.on('close', () => {
      void dispatcher.close({ reason: 'TRANSPORT_LOST', useGrace: true })
        .catch((error) => logger.error('session_cleanup_failure', { socketId, ...safeErrorMetadata(error) }))
        .finally(release);
    });
  });
  server.listen(port, () => logger.info('listening', { port, channel: name }));
  return server;
}

function startServers({
  repository = new MemoryRepository(),
  worldSession = undefined,
  socketIds = defaultSocketIds,
  gameOptions = {},
  sessionAuthority = null,
  authPort = Number(process.env.AUTH_PORT || 15100),
  gamePort = Number(process.env.GAME_PORT || 15001),
  loggerFactory = (name) => createLogger({ name }),
} = {}) {
  const world = worldSession === undefined ? tryLoadWorldSession(repository) : worldSession;
  const authLogger = loggerFactory('ko1298-auth');
  const gameLogger = loggerFactory('ko1298-game');
  const auth = listen(
    authPort,
    ({ logger }) => new AuthSession(repository, {
      gameHost: process.env.GAME_HOST || '127.0.0.1',
      gameName: 'OldKO',
      logger,
    }),
    'auth',
    { logger: authLogger, socketIds },
  );
  const game = listen(
    gamePort,
    ({ socketId, logger }) => new GameSession(repository, {
      worldSession: world,
      socketId,
      serverId: process.env.OLDKO_SERVER_ID || 'oldko-game',
      logger,
      ...gameOptions,
    }),
    'game',
    { logger: gameLogger, socketIds, sessionAuthority },
  );
  return { auth, game, repository, worldSession: world, sessionAuthority };
}

function sanitizeLogMetadata(metadata) {
  const result = {};
  const denied = /(password|secret|token|credential|payload|body|publicKey|privateKey)/i;
  for (const [key, value] of Object.entries(metadata || {})) {
    if (denied.test(key)) continue;
    if (Buffer.isBuffer(value)) {
      result[`${key}Length`] = value.length;
      continue;
    }
    if (value && typeof value === 'object') {
      if (key === 'details') result.details = sanitizeLogMetadata(value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

if (require.main === module) startServers();

module.exports = {
  SocketIdPool,
  tryLoadWorldSession,
  allocateSocketId,
  releaseSocketId,
  createLogger,
  listen,
  startServers,
  sanitizeLogMetadata,
};
