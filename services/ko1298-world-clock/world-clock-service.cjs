'use strict';

const {
  GAME_TICK_REAL_MS,
  WeatherType,
  validateGameTime,
  addGameMinutes,
  compareGameTime,
  validateWeather,
  makeTimeBroadcast,
  makeWeatherBroadcast,
  roll1298Weather,
} = require('./model.cjs');
const { InMemoryScheduleRepository } = require('./schedule-repository.cjs');
const { DeterministicWorldScheduler } = require('./deterministic-scheduler.cjs');

function assertBroadcaster(broadcaster) {
  const value = broadcaster ?? {};
  for (const method of ['publishTime', 'publishWeather']) {
    if (value[method] !== undefined && typeof value[method] !== 'function') {
      throw new TypeError(`broadcaster.${method} must be a function`);
    }
  }
  return {
    publishTime: value.publishTime ?? (() => {}),
    publishWeather: value.publishWeather ?? (() => {}),
  };
}

class WorldClockService {
  constructor({
    initialTime = { year: 1, month: 1, day: 1, hour: 1, minute: 0 },
    initialWeather = { type: WeatherType.CLEAR, intensity: 0 },
    broadcaster,
    scheduleRepository = new InMemoryScheduleRepository(),
    onScheduledEvent = async () => {},
    randomInt,
  } = {}) {
    this.time = validateGameTime(initialTime);
    this.weather = validateWeather(initialWeather);
    this.broadcaster = assertBroadcaster(broadcaster);
    if (typeof onScheduledEvent !== 'function') throw new TypeError('onScheduledEvent must be a function');
    if (randomInt !== undefined && typeof randomInt !== 'function') throw new TypeError('randomInt must be a function');
    this.randomInt = randomInt;
    this.realTimeRemainderMs = 0;
    this.scheduler = new DeterministicWorldScheduler({
      repository: scheduleRepository,
      onTrigger: onScheduledEvent,
    });
  }

  async recoverSchedules() {
    return this.scheduler.recover();
  }

  getSnapshot() {
    return Object.freeze({
      time: structuredClone(this.time),
      weather: structuredClone(this.weather),
      tickRealMilliseconds: GAME_TICK_REAL_MS,
      calendar: Object.freeze({ daysPerMonth: 30, monthsPerYear: 12 }),
    });
  }

  getTimeBroadcast() {
    return makeTimeBroadcast(this.time);
  }

  getWeatherBroadcast() {
    return makeWeatherBroadcast(this.weather);
  }

  broadcastCurrentState() {
    const timePacket = this.getTimeBroadcast();
    const weatherPacket = this.getWeatherBroadcast();
    this.broadcaster.publishTime(timePacket);
    this.broadcaster.publishWeather(weatherPacket);
    return Object.freeze({ time: timePacket, weather: weatherPacket });
  }

  async scheduleEvent(event) {
    return this.scheduler.schedule(event);
  }

  listScheduledEvents() {
    return this.scheduler.listPending();
  }

  async advanceTick() {
    const previous = this.time;
    this.time = addGameMinutes(this.time, 1);

    // 1.298 Ebenezer changes weather on the hour. Weather is the state that is
    // actually broadcast here; WIZ_TIME remains an explicit broadcast contract
    // for WS14/session bootstrap and controlled GM time changes.
    if (previous.minute === 59 && this.time.minute === 0) {
      this.weather = roll1298Weather(this.randomInt);
      this.broadcaster.publishWeather(this.getWeatherBroadcast());
    }

    const scheduleResult = await this.scheduler.processDue(this.time, {
      source: 'clock-tick',
    });

    return Object.freeze({
      snapshot: this.getSnapshot(),
      scheduleResult,
    });
  }

  async advanceRealMilliseconds(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError('milliseconds must be a non-negative finite number');
    }
    this.realTimeRemainderMs += milliseconds;
    let ticks = 0;
    while (this.realTimeRemainderMs >= GAME_TICK_REAL_MS) {
      this.realTimeRemainderMs -= GAME_TICK_REAL_MS;
      await this.advanceTick();
      ticks++;
    }
    return Object.freeze({ ticks, remainderMilliseconds: this.realTimeRemainderMs, snapshot: this.getSnapshot() });
  }

  async setTime(target, options = {}) {
    const next = validateGameTime(target);
    const backwards = compareGameTime(next, this.time) < 0;
    if (backwards && options.allowBackward !== true) {
      const error = new Error('backwards game-time change rejected');
      error.code = 'BACKWARDS_TIME_NOT_ALLOWED';
      throw error;
    }

    this.time = next;
    this.broadcaster.publishTime(this.getTimeBroadcast());

    const scheduleResult = await this.scheduler.processDue(this.time, {
      source: 'controlled-set-time',
      actor: options.actor ?? null,
      reason: options.reason ?? null,
      forcedBackwards: backwards,
    });

    return Object.freeze({ snapshot: this.getSnapshot(), scheduleResult });
  }

  setWeather(nextWeather, options = {}) {
    this.weather = validateWeather(nextWeather);
    const packet = this.getWeatherBroadcast();
    this.broadcaster.publishWeather(packet);
    return Object.freeze({
      snapshot: this.getSnapshot(),
      audit: Object.freeze({
        source: 'controlled-set-weather',
        actor: options.actor ?? null,
        reason: options.reason ?? null,
      }),
    });
  }
}

module.exports = {
  WorldClockService,
  assertBroadcaster,
};
