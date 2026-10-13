'use strict';

const net = require('node:net');
const { FrameDecoder, frame } = require('./protocol');
const { MemoryRepository } = require('./repository');
const { AuthSession, GameSession } = require('./session');

const repo = new MemoryRepository();
const worldSession = tryLoadWorldSession(repo);
let nextSocketId = 1;

function tryLoadWorldSession(repository) {
  try {
    // This module is supplied by WS14 after integration. Keeping the require here
    // makes the ownership boundary explicit without copying world logic into WS03.
    const { WorldSessionService } = require('../ko1298-world');
    return new WorldSessionService({ repository });
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes('ko1298-world')) return null;
    throw error;
  }
}

function allocateSocketId() {
  const id = nextSocketId;
  nextSocketId = nextSocketId >= 0xffff ? 1 : nextSocketId + 1;
  return id;
}

function listen(port, makeSession, name) {
  const server = net.createServer((socket) => {
    const decoder = new FrameDecoder();
    const session = makeSession({ socketId: name === 'game' ? allocateSocketId() : 0 });
    let queue = Promise.resolve();

    socket.on('data', (chunk) => {
      queue = queue.then(async () => {
        for (const payload of decoder.push(chunk)) {
          const responses = await session.handle(payload);
          for (const response of responses) socket.write(frame(response));
        }
      }).catch((error) => socket.destroy(error));
    });
  });
  server.listen(port, () => console.log(`${name} listening on ${port}`));
  return server;
}

listen(
  Number(process.env.AUTH_PORT || 15100),
  () => new AuthSession(repo, { gameHost: process.env.GAME_HOST || '127.0.0.1', gameName: 'OldKO' }),
  'auth',
);

listen(
  Number(process.env.GAME_PORT || 15001),
  ({ socketId }) => new GameSession(repo, { worldSession, socketId }),
  'game',
);

module.exports = { tryLoadWorldSession, allocateSocketId };
