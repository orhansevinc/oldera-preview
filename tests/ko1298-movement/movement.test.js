'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MovementService,
  MovementRejectedError,
  SlidingWindowFloodGuard,
  StaticZoneBounds,
} = require('../../services/ko1298-movement/src');

function packet({ x, z, y = 0, speed, flag }) {
  const buf = Buffer.alloc(9);
  buf.writeUInt16LE(Math.round(x * 10), 0);
  buf.writeUInt16LE(Math.round(z * 10), 2);
  buf.writeInt16LE(Math.round(y * 10), 4);
  buf.writeUInt16LE(Math.round(speed * 10), 6);
  buf.writeUInt8(flag, 8);
  return buf;
}

function fixture(options = {}) {
  let now = 1_000;
  const events = [];
  const teleports = [];
  const disconnects = [];
  const bounds = new StaticZoneBounds({
    21: { minX: 0, maxX: 1000, minY: -100, maxY: 300, minZ: 0, maxZ: 1000 },
    1: { minX: 0, maxX: 500, minY: -100, maxY: 300, minZ: 0, maxZ: 500 },
  });
  const service = new MovementService({
    zoneBounds: bounds,
    broadcast: (event) => events.push(event),
    onTeleport: (event) => teleports.push(event),
    onDisconnect: (event) => disconnects.push(event),
    clock: () => now,
    speedPolicy: () => 10,
    config: { positionSlack: 0.5, ...options.config },
    floodGuard: options.floodGuard,
  });
  return {
    service,
    events,
    teleports,
    disconnects,
    setNow(value) { now = value; },
    advance(ms) { now += ms; },
  };
}

test('maintains 1298 authoritative current/target semantics across start, update and end', () => {
  const f = fixture();
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });

  const start = f.service.handleMovePacket('a', packet({ x: 104, z: 100, speed: 4, flag: 0x01 }));
  assert.deepEqual(start.state.position, { x: 100, y: 0, z: 100 });
  assert.deepEqual(start.state.targetPosition, { x: 104, y: 0, z: 100 });
  assert.equal(start.state.moving, true);

  f.advance(1000);
  const update = f.service.handleMovePacket('a', packet({ x: 108, z: 100, speed: 4, flag: 0x03 }));
  assert.deepEqual(update.state.position, { x: 104, y: 0, z: 100 });
  assert.deepEqual(update.state.targetPosition, { x: 108, y: 0, z: 100 });

  f.advance(300);
  const stop = f.service.handleMovePacket('a', packet({ x: 105, z: 100, speed: 0, flag: 0x00 }));
  assert.deepEqual(stop.state.position, { x: 105, y: 0, z: 100 });
  assert.deepEqual(stop.state.targetPosition, { x: 105, y: 0, z: 100 });
  assert.equal(stop.state.moving, false);
});

test('rejects speed/range abuse, zone exits and impossible wire coordinates', () => {
  const f = fixture();
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });

  assert.throws(
    () => f.service.handleMovePacket('a', packet({ x: 101, z: 100, speed: 11, flag: 0x01 })),
    (error) => error instanceof MovementRejectedError && error.code === 'speed_limit',
  );

  assert.throws(
    () => f.service.handleMovePacket('a', packet({ x: 150, z: 100, speed: 4, flag: 0x01 })),
    (error) => error.code === 'range_limit',
  );

  assert.throws(
    () => f.service.handleMovePacket('a', packet({ x: 1001, z: 100, speed: 4, flag: 0x01 })),
    (error) => ['zone_bounds', 'coordinate_overflow'].includes(error.code),
  );

  assert.throws(
    () => f.service.handleMove('a', {
      rawX: 1, rawZ: 1, rawY: 0, rawSpeed: 10, flag: 1,
      moving: true, continuous: false, phase: 'start', speed: 1,
      position: { x: Number.NaN, y: 0, z: 1 },
    }),
    (error) => error.code === 'non_finite_coordinate',
  );

  assert.throws(
    () => f.service.handleMove('a', {
      rawX: 70000, rawZ: 1, rawY: 0, rawSpeed: 10, flag: 1,
      moving: true, continuous: false, phase: 'start', speed: 1,
      position: { x: 7000, y: 0, z: 1 },
    }),
    (error) => error.code === 'integer_overflow',
  );
});

test('broadcasts accepted movement and heading only to sessions in the same zone', () => {
  const f = fixture();
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
  f.service.registerSession({ sessionId: 'b', entityId: 11, zoneId: 21, position: { x: 101, y: 0, z: 100 } });
  f.service.registerSession({ sessionId: 'c', entityId: 12, zoneId: 1, position: { x: 100, y: 0, z: 100 } });

  const move = f.service.handleMovePacket('a', packet({ x: 104, z: 100, speed: 4, flag: 0x01 }));
  assert.deepEqual(move.recipients.sort(), ['a', 'b']);
  assert.equal(f.events.at(-1).zoneId, 21);

  const rotatePayload = Buffer.alloc(2);
  rotatePayload.writeInt16LE(123, 0);
  const rotate = f.service.handleRotatePacket('a', rotatePayload);
  assert.deepEqual(rotate.recipients.sort(), ['a', 'b']);
  assert.equal(rotate.state.headingRaw, 123);
});

test('teleport resets movement baseline without synthesizing WIZ_MOVE', () => {
  const f = fixture();
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
  f.service.handleMovePacket('a', packet({ x: 104, z: 100, speed: 4, flag: 0x01 }));
  const eventCount = f.events.length;

  const state = f.service.teleport('a', {
    zoneId: 1,
    position: { x: 50, y: 2, z: 60 },
    headingRaw: -300,
    reason: 'zone-transition',
  });

  assert.equal(state.zoneId, 1);
  assert.deepEqual(state.position, { x: 50, y: 2, z: 60 });
  assert.deepEqual(state.targetPosition, { x: 50, y: 2, z: 60 });
  assert.equal(state.moving, false);
  assert.equal(state.teleportGeneration, 1);
  assert.equal(f.events.length, eventCount);
  assert.equal(f.teleports.length, 1);
});

test('disconnect removes authoritative state and flood accounting', () => {
  const floodGuard = new SlidingWindowFloodGuard({ windowMs: 1000, maxPackets: 2 });
  const f = fixture({ floodGuard });
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });
  assert.equal(f.service.disconnect('a'), true);
  assert.equal(f.service.getState('a'), null);
  assert.equal(f.disconnects.length, 1);
  assert.equal(f.service.disconnect('a'), false);
});

test('packet flood guard rejects excessive movement and exposes hook event', () => {
  const floods = [];
  const floodGuard = new SlidingWindowFloodGuard({ windowMs: 1000, maxPackets: 2, onFlood: (event) => floods.push(event) });
  const f = fixture({ floodGuard, config: { positionSlack: 10 } });
  f.service.registerSession({ sessionId: 'a', entityId: 10, zoneId: 21, position: { x: 100, y: 0, z: 100 } });

  f.service.handleMovePacket('a', packet({ x: 101, z: 100, speed: 1, flag: 0x01 }));
  f.advance(100);
  f.service.handleMovePacket('a', packet({ x: 101.1, z: 100, speed: 1, flag: 0x03 }));
  f.advance(100);
  assert.throws(
    () => f.service.handleMovePacket('a', packet({ x: 101.2, z: 100, speed: 1, flag: 0x03 })),
    (error) => error.code === 'packet_flood',
  );
  assert.equal(floods.length, 1);
  assert.equal(floods[0].sessionId, 'a');
});
