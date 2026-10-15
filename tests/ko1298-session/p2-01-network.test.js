'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MovementService, StaticZoneBounds } = require('../../services/ko1298-movement/src');
const { PersistentMovementPort } = require('../../services/ko1298-session/persistent-movement-port');

function movePayload(x, z, speed, flag, y = 0) {
  const buf = Buffer.alloc(9);
  buf.writeUInt16LE(Math.round(x * 10), 0);
  buf.writeUInt16LE(Math.round(z * 10), 2);
  buf.writeInt16LE(Math.round(y * 10), 4);
  buf.writeUInt16LE(Math.round(speed * 10), 6);
  buf.writeUInt8(flag, 8);
  return buf;
}

function rotatePayload(headingRaw) {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(headingRaw, 0);
  return buf;
}

function fixture() {
  let now = 1_000_000;
  const saves = [];
  const broadcasts = [];
  const movement = new MovementService({
    zoneBounds: new StaticZoneBounds({
      21: { minX: 0, maxX: 60000, minY: -1000, maxY: 1000, minZ: 0, maxZ: 60000 },
    }),
    clock: () => now,
    speedPolicy: (state) => state.maxSpeed ?? 8,
    broadcast: (event) => broadcasts.push(event),
  });
  const repository = {
    async saveWorldPosition(row) { saves.push({ ...row }); },
  };
  const worldSession = {
    getSession(entityId) {
      return entityId === 100 ? { accountId: 'acct', characterId: 'char' } : null;
    },
  };
  const port = new PersistentMovementPort({ movement, repository, worldSession });
  return {
    port,
    movement,
    saves,
    broadcasts,
    advance(ms) { now += ms; },
    now() { return now; },
  };
}

test('15-minute virtual walk/run/sprint/stop/turn soak accepts legitimate 1298 movement without disconnect outcome', async () => {
  const f = fixture();
  f.port.registerSession({ sessionId: 'game:1', entityId: 100, zoneId: 21, position: { x: 1000, y: 0, z: 1000 }, maxSpeed: 8 });

  let x = 1000;
  let moving = false;
  let receiveSequence = 0;
  const speeds = [1.5, 4.5, 6.5];

  for (let i = 0; i < 600; i += 1) {
    const speed = speeds[i % speeds.length];
    x += speed;
    const flag = moving ? 0x03 : 0x01;
    const move = await f.port.handleMovePacket('game:1', movePayload(x, 1000, speed, flag), { receiveSequence: ++receiveSequence });
    assert.equal(move.accepted, true, `movement rejected at iteration ${i}`);
    assert.notEqual(move.disconnect, true);
    moving = true;

    if (i % 10 === 0) {
      const turn = await f.port.handleRotatePacket('game:1', rotatePayload((i * 97) % 30000), { receiveSequence: ++receiveSequence });
      assert.equal(turn.accepted, true);
    }
    if (i % 20 === 19) {
      const stop = await f.port.handleMovePacket('game:1', movePayload(x, 1000, 0, 0x00), { receiveSequence: ++receiveSequence });
      assert.equal(stop.accepted, true);
      moving = false;
    }
    f.advance(1500);
  }

  assert.equal(f.now(), 1_900_000, 'virtual soak must cover exactly 15 minutes');
  assert.ok(f.saves.length >= 600, 'accepted moves must persist authoritative world position');
  assert.equal(f.port.getState('game:1').zoneId, 21);
});

test('invalid speed remains rejected without becoming a transport disconnect', async () => {
  const f = fixture();
  f.port.registerSession({ sessionId: 'game:1', entityId: 100, zoneId: 21, position: { x: 1000, y: 0, z: 1000 }, maxSpeed: 8 });
  const outcome = await f.port.handleMovePacket('game:1', movePayload(1050, 1000, 25, 0x01));
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.disconnect, false);
  assert.equal(outcome.rejection.code, 'speed_limit');
  assert.equal(f.saves.length, 0);
  assert.deepEqual(f.port.getState('game:1').position, { x: 1000, y: 0, z: 1000 });
});

test('P2-04 baseline reset is trusted teleport and clears running state before subsequent movement', async () => {
  const f = fixture();
  f.port.registerSession({ sessionId: 'game:1', entityId: 100, zoneId: 21, position: { x: 1000, y: 0, z: 1000 }, maxSpeed: 8 });
  await f.port.handleMovePacket('game:1', movePayload(1004, 1000, 4.5, 0x01));
  const reset = f.port.resetMovementBaseline('game:1', { zoneId: 21, position: { x: 5000, y: 0, z: 5000 }, headingRaw: -1234, reason: 'P2-04:zone-transfer' });
  assert.deepEqual(reset.position, { x: 5000, y: 0, z: 5000 });
  assert.equal(reset.moving, false);
  assert.equal(reset.speed, 0);
  assert.equal(reset.moveFlag, 0);
  assert.equal(reset.headingRaw, -1234);
  assert.ok(reset.teleportGeneration > 0);

  f.advance(1500);
  const next = await f.port.handleMovePacket('game:1', movePayload(5004, 5000, 4.5, 0x01));
  assert.equal(next.accepted, true);
});

test('P2-07 speedPolicy allows legitimate buffed speed but still caps excessive speed', async () => {
  let cap = 4.5;
  let now = 1000;
  const movement = new MovementService({
    zoneBounds: new StaticZoneBounds({ 21: { minX: 0, maxX: 10000, minY: -100, maxY: 100, minZ: 0, maxZ: 10000 } }),
    clock: () => now,
    speedPolicy: () => cap,
  });
  movement.registerSession({ sessionId: 'p', entityId: 1, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
  assert.equal(movement.handleMovePacket('p', movePayload(104, 100, 4.5, 0x01)).accepted, true);
  now += 1500;
  cap = 7.0;
  assert.equal(movement.handleMovePacket('p', movePayload(110, 100, 6.5, 0x03)).accepted, true);
  now += 1500;
  assert.throws(() => movement.handleMovePacket('p', movePayload(130, 100, 12, 0x03)), (error) => error?.code === 'speed_limit');
});