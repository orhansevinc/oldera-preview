'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  GAME_TICK_REAL_MS,
  WeatherType,
  WorldClockService,
  InMemoryScheduleRepository,
  addGameMinutes,
  makeTimeBroadcast,
  makeWeatherBroadcast,
  roll1298Weather,
} = require('../../services/ko1298-world-clock/index.cjs');

function sequenceRandom(values) {
  let index = 0;
  return (min, max) => {
    const value = values[index++];
    assert.ok(value >= min && value <= max, `random fixture ${value} outside [${min}, ${max}]`);
    return value;
  };
}

test('1298 calendar uses 6 real seconds per game minute and 30-day months', async () => {
  const service = new WorldClockService({
    initialTime: { year: 1, month: 12, day: 30, hour: 23, minute: 59 },
    randomInt: sequenceRandom([50, 20]),
  });

  const result = await service.advanceRealMilliseconds(GAME_TICK_REAL_MS);
  assert.equal(result.ticks, 1);
  assert.deepEqual(service.getSnapshot().time, {
    year: 2,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
  });
});

test('partial real-time advancement is accumulated deterministically', async () => {
  const service = new WorldClockService();
  let result = await service.advanceRealMilliseconds(5_999);
  assert.equal(result.ticks, 0);
  assert.equal(service.getSnapshot().time.minute, 0);

  result = await service.advanceRealMilliseconds(1);
  assert.equal(result.ticks, 1);
  assert.equal(service.getSnapshot().time.minute, 1);
});

test('calendar arithmetic follows fixed 30-day, 12-month model', () => {
  assert.deepEqual(
    addGameMinutes({ year: 3, month: 4, day: 30, hour: 23, minute: 59 }, 1),
    { year: 3, month: 5, day: 1, hour: 0, minute: 0 },
  );
});

test('broadcast contracts match 1298 time/weather opcodes and payload fields', () => {
  assert.deepEqual(makeTimeBroadcast({ year: 2, month: 3, day: 4, hour: 5, minute: 6 }), {
    opcode: 0x13,
    year: 2,
    month: 3,
    day: 4,
    hour: 5,
    minute: 6,
  });
  assert.deepEqual(makeWeatherBroadcast({ type: WeatherType.SNOW, intensity: 75 }), {
    opcode: 0x14,
    type: 3,
    intensity: 75,
  });
});

test('1298 weather transition policy only emits clear/rain/snow with original thresholds', () => {
  assert.deepEqual(roll1298Weather(sequenceRandom([0, 88])), { type: WeatherType.SNOW, intensity: 88 });
  assert.deepEqual(roll1298Weather(sequenceRandom([2, 44])), { type: WeatherType.RAIN, intensity: 44 });
  assert.deepEqual(roll1298Weather(sequenceRandom([7, 70])), { type: WeatherType.CLEAR, intensity: 0 });
  assert.deepEqual(roll1298Weather(sequenceRandom([100, 90])), { type: WeatherType.CLEAR, intensity: 45 });
});

test('hour boundary transitions weather and publishes only the weather transition automatically', async () => {
  const publishedTime = [];
  const publishedWeather = [];
  const service = new WorldClockService({
    initialTime: { year: 1, month: 1, day: 1, hour: 10, minute: 59 },
    randomInt: sequenceRandom([2, 61]),
    broadcaster: {
      publishTime: (packet) => publishedTime.push(packet),
      publishWeather: (packet) => publishedWeather.push(packet),
    },
  });

  await service.advanceTick();
  assert.equal(publishedTime.length, 0);
  assert.deepEqual(publishedWeather, [{ opcode: 0x14, type: WeatherType.RAIN, intensity: 61 }]);
});

test('explicit state broadcast lets WS14 bootstrap a session without coupling implementations', () => {
  const calls = [];
  const service = new WorldClockService({
    broadcaster: {
      publishTime: (packet) => calls.push(['time', packet]),
      publishWeather: (packet) => calls.push(['weather', packet]),
    },
  });

  service.broadcastCurrentState();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].opcode, 0x13);
  assert.equal(calls[1][1].opcode, 0x14);
});

test('controlled set-time rejects backwards movement by default', async () => {
  const service = new WorldClockService({
    initialTime: { year: 4, month: 2, day: 3, hour: 10, minute: 0 },
  });

  await assert.rejects(
    service.setTime({ year: 4, month: 2, day: 3, hour: 9, minute: 59 }),
    (error) => error.code === 'BACKWARDS_TIME_NOT_ALLOWED',
  );
});

test('controlled set-time/set-weather publish through interfaces and accept audit metadata', async () => {
  const calls = [];
  const service = new WorldClockService({
    broadcaster: {
      publishTime: (packet) => calls.push(['time', packet]),
      publishWeather: (packet) => calls.push(['weather', packet]),
    },
  });

  await service.setTime(
    { year: 1, month: 1, day: 1, hour: 2, minute: 30 },
    { actor: 'gm:42', reason: 'ops-test' },
  );
  service.setWeather(
    { type: WeatherType.SNOW, intensity: 20 },
    { actor: 'gm:42', reason: 'ops-test' },
  );

  assert.equal(calls[0][0], 'time');
  assert.equal(calls[1][0], 'weather');
  assert.equal(calls[1][1].type, WeatherType.SNOW);
});

test('scheduled events trigger deterministically by due time then id and exactly once', async () => {
  const triggered = [];
  const repository = new InMemoryScheduleRepository();
  const service = new WorldClockService({
    initialTime: { year: 1, month: 1, day: 1, hour: 1, minute: 0 },
    scheduleRepository: repository,
    onScheduledEvent: async (event) => triggered.push(event.id),
  });
  await service.recoverSchedules();

  await service.scheduleEvent({
    id: 'b-event',
    kind: 'zone-owned-event-hook',
    at: { year: 1, month: 1, day: 1, hour: 1, minute: 1 },
  });
  await service.scheduleEvent({
    id: 'a-event',
    kind: 'zone-owned-event-hook',
    at: { year: 1, month: 1, day: 1, hour: 1, minute: 1 },
  });

  await service.advanceTick();
  await service.advanceTick();
  assert.deepEqual(triggered, ['a-event', 'b-event']);
  assert.deepEqual(service.listScheduledEvents(), []);
  assert.equal(repository.snapshot().filter((record) => record.triggered).length, 2);
});

test('pending schedule recovers after restart through repository port', async () => {
  const repository = new InMemoryScheduleRepository();
  const first = new WorldClockService({ scheduleRepository: repository });
  await first.recoverSchedules();
  await first.scheduleEvent({
    id: 'recover-me',
    kind: 'external-world-event',
    at: { year: 1, month: 1, day: 1, hour: 1, minute: 2 },
    payload: { owner: 'another-workstream' },
  });

  const triggered = [];
  const second = new WorldClockService({
    initialTime: { year: 1, month: 1, day: 1, hour: 1, minute: 1 },
    scheduleRepository: repository,
    onScheduledEvent: async (event) => triggered.push(event.id),
  });
  const recovered = await second.recoverSchedules();
  assert.equal(recovered.length, 1);

  await second.advanceTick();
  assert.deepEqual(triggered, ['recover-me']);
});

test('forced backwards time does not replay already-triggered schedules', async () => {
  const triggered = [];
  const repository = new InMemoryScheduleRepository();
  const service = new WorldClockService({
    initialTime: { year: 1, month: 1, day: 1, hour: 1, minute: 0 },
    scheduleRepository: repository,
    onScheduledEvent: async (event) => triggered.push(event.id),
  });
  await service.recoverSchedules();
  await service.scheduleEvent({
    id: 'once',
    kind: 'external-world-event',
    at: { year: 1, month: 1, day: 1, hour: 1, minute: 1 },
  });

  await service.advanceTick();
  await service.setTime(
    { year: 1, month: 1, day: 1, hour: 1, minute: 0 },
    { allowBackward: true, actor: 'gm:42', reason: 'recovery-test' },
  );
  await service.advanceTick();

  assert.deepEqual(triggered, ['once']);
});

test('invalid weather states outside the real 1298 set are rejected', () => {
  const service = new WorldClockService();
  assert.throws(() => service.setWeather({ type: 4, intensity: 10 }), /CLEAR\(1\), RAIN\(2\), or SNOW\(3\)/);
  assert.throws(() => service.setWeather({ type: WeatherType.RAIN, intensity: 101 }), /\[0, 100\]/);
});
