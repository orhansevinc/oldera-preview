'use strict';

const OPCODE_TIME = 0x13;
const OPCODE_WEATHER = 0x14;
const GAME_TICK_REAL_MS = 6_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;
const MONTHS_PER_YEAR = 12;

const WeatherType = Object.freeze({
  CLEAR: 1,
  RAIN: 2,
  SNOW: 3,
});

function assertInteger(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
}

function validateGameTime(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('game time must be an object');
  }

  assertInteger('year', value.year, 1, 32767);
  assertInteger('month', value.month, 1, MONTHS_PER_YEAR);
  assertInteger('day', value.day, 1, DAYS_PER_MONTH);
  assertInteger('hour', value.hour, 0, HOURS_PER_DAY - 1);
  assertInteger('minute', value.minute, 0, MINUTES_PER_HOUR - 1);

  return Object.freeze({
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
  });
}

function toSerialMinute(time) {
  const t = validateGameTime(time);
  const months = (t.year - 1) * MONTHS_PER_YEAR + (t.month - 1);
  const days = months * DAYS_PER_MONTH + (t.day - 1);
  const hours = days * HOURS_PER_DAY + t.hour;
  return hours * MINUTES_PER_HOUR + t.minute;
}

function fromSerialMinute(serialMinute) {
  if (!Number.isSafeInteger(serialMinute) || serialMinute < 0) {
    throw new RangeError('serialMinute must be a non-negative safe integer');
  }

  let rest = serialMinute;
  const minute = rest % MINUTES_PER_HOUR;
  rest = Math.floor(rest / MINUTES_PER_HOUR);
  const hour = rest % HOURS_PER_DAY;
  rest = Math.floor(rest / HOURS_PER_DAY);
  const day = (rest % DAYS_PER_MONTH) + 1;
  rest = Math.floor(rest / DAYS_PER_MONTH);
  const month = (rest % MONTHS_PER_YEAR) + 1;
  const year = Math.floor(rest / MONTHS_PER_YEAR) + 1;

  return validateGameTime({ year, month, day, hour, minute });
}

function addGameMinutes(time, deltaMinutes) {
  if (!Number.isSafeInteger(deltaMinutes)) {
    throw new TypeError('deltaMinutes must be a safe integer');
  }
  const next = toSerialMinute(time) + deltaMinutes;
  if (next < 0) {
    throw new RangeError('game time cannot move before year 1/month 1/day 1 00:00');
  }
  return fromSerialMinute(next);
}

function compareGameTime(a, b) {
  return Math.sign(toSerialMinute(a) - toSerialMinute(b));
}

function validateWeather(value) {
  if (!value || typeof value !== 'object') {
    throw new TypeError('weather must be an object');
  }

  const type = value.type;
  if (![WeatherType.CLEAR, WeatherType.RAIN, WeatherType.SNOW].includes(type)) {
    throw new RangeError('weather type must be CLEAR(1), RAIN(2), or SNOW(3)');
  }
  assertInteger('weather intensity', value.intensity, 0, 100);

  return Object.freeze({ type, intensity: value.intensity });
}

function makeTimeBroadcast(time) {
  const t = validateGameTime(time);
  return Object.freeze({
    opcode: OPCODE_TIME,
    year: t.year,
    month: t.month,
    day: t.day,
    hour: t.hour,
    minute: t.minute,
  });
}

function makeWeatherBroadcast(weather) {
  const w = validateWeather(weather);
  return Object.freeze({
    opcode: OPCODE_WEATHER,
    type: w.type,
    intensity: w.intensity,
  });
}

function defaultRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function roll1298Weather(randomInt = defaultRandomInt) {
  const roll = randomInt(0, 100);
  assertInteger('weather roll', roll, 0, 100);

  let type;
  if (roll < 2) type = WeatherType.SNOW;
  else if (roll < 7) type = WeatherType.RAIN;
  else type = WeatherType.CLEAR;

  let intensity = randomInt(0, 100);
  assertInteger('weather amount roll', intensity, 0, 100);

  // Ebenezer 1298 treats the clear-weather amount as fog amount.
  // When <=70 it is zero; otherwise the amount is halved.
  if (type === WeatherType.CLEAR) {
    intensity = intensity > 70 ? Math.floor(intensity / 2) : 0;
  }

  return validateWeather({ type, intensity });
}

module.exports = {
  OPCODE_TIME,
  OPCODE_WEATHER,
  GAME_TICK_REAL_MS,
  MINUTES_PER_HOUR,
  HOURS_PER_DAY,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  WeatherType,
  validateGameTime,
  toSerialMinute,
  fromSerialMinute,
  addGameMinutes,
  compareGameTime,
  validateWeather,
  makeTimeBroadcast,
  makeWeatherBroadcast,
  roll1298Weather,
};
