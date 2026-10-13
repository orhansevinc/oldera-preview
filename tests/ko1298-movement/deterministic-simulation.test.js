'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MovementService, StaticZoneBounds } = require('../../services/ko1298-movement/src');

function payload(x, z, speed, flag) {
  const buf = Buffer.alloc(9);
  buf.writeUInt16LE(Math.round(x * 10), 0);
  buf.writeUInt16LE(Math.round(z * 10), 2);
  buf.writeInt16LE(0, 4);
  buf.writeUInt16LE(Math.round(speed * 10), 6);
  buf.writeUInt8(flag, 8);
  return buf;
}

test('deterministic two-player simulation yields stable authoritative states and broadcasts', () => {
  let now = 10_000;
  const transcript = [];
  const service = new MovementService({
    zoneBounds: new StaticZoneBounds({
      21: { minX: 0, maxX: 1000, minY: -100, maxY: 100, minZ: 0, maxZ: 1000 },
    }),
    clock: () => now,
    speedPolicy: () => 8,
    broadcast: (event) => transcript.push({
      t: now,
      kind: event.kind,
      sender: event.senderSessionId,
      recipients: [...event.recipients],
      hex: event.packet.toString('hex'),
    }),
  });

  service.registerSession({ sessionId: 'p1', entityId: 100, zoneId: 21, position: { x: 50, y: 0, z: 50 } });
  service.registerSession({ sessionId: 'p2', entityId: 101, zoneId: 21, position: { x: 55, y: 0, z: 50 } });

  service.handleMovePacket('p1', payload(54, 50, 4, 0x01));
  now += 1000;
  service.handleMovePacket('p1', payload(58, 50, 4, 0x03));
  now += 1000;
  service.handleMovePacket('p2', payload(55, 54, 4, 0x01));
  now += 1000;
  service.handleMovePacket('p2', payload(55, 58, 4, 0x03));
  now += 250;
  service.handleMovePacket('p1', payload(57, 50, 0, 0x00));

  assert.deepEqual(service.getState('p1').position, { x: 57, y: 0, z: 50 });
  assert.deepEqual(service.getState('p2').position, { x: 55, y: 0, z: 54 });
  assert.deepEqual(service.getState('p2').targetPosition, { x: 55, y: 0, z: 58 });
  assert.deepEqual(transcript, [
    { t: 10000, kind: 'move', sender: 'p1', recipients: ['p1', 'p2'], hex: '0664001c02f4010000280001' },
    { t: 11000, kind: 'move', sender: 'p1', recipients: ['p1', 'p2'], hex: '0664004402f4010000280003' },
    { t: 12000, kind: 'move', sender: 'p2', recipients: ['p1', 'p2'], hex: '06650026021c020000280001' },
    { t: 13000, kind: 'move', sender: 'p2', recipients: ['p1', 'p2'], hex: '066500260244020000280003' },
    { t: 13250, kind: 'move', sender: 'p1', recipients: ['p1', 'p2'], hex: '0664003a02f4010000000000' },
  ]);
});
