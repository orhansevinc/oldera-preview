# WS36 Integration Patch

## Branch

`ws36-world-clock`

## Export surface

Import from:

```js
const {
  WorldClockService,
  WeatherType,
  InMemoryScheduleRepository,
} = require('services/ko1298-world-clock');
```

## WS14 world/session integration

WS14 should depend on the public interface only.

```js
const clock = new WorldClockService({
  broadcaster: {
    publishTime(packet) {
      // Adapter serializes packet as KO 1298 WIZ_TIME (0x13).
    },
    publishWeather(packet) {
      // Adapter serializes packet as KO 1298 WIZ_WEATHER (0x14).
    },
  },
});

// On player/session world bootstrap:
const { time, weather } = clock.broadcastCurrentState();
```

WS36 does not call WS14 and does not know session/user objects.

## Runtime tick integration

Feed monotonic elapsed duration or invoke one game tick every 6000 ms:

```js
await clock.advanceRealMilliseconds(elapsedMonotonicMs);
// or: await clock.advanceTick();
```

Do not derive the game clock from host local time, UTC offset, or DST.

## WS28 command-bus integration

WS28 should expose its own authorization/audit policy and call only these domain methods:

```js
await clock.setTime(
  { year: 1, month: 3, day: 10, hour: 18, minute: 0 },
  { actor: principalId, reason: 'gm-command' },
);

clock.setWeather(
  { type: WeatherType.RAIN, intensity: 50 },
  { actor: principalId, reason: 'gm-command' },
);
```

Backwards time is rejected unless WS28 deliberately passes `allowBackward: true`. That opt-in should require elevated authorization because scheduled-event replay protection will hold the previous scheduler high-watermark until game time catches up.

## Scheduled world-event integration

Event-owning workstreams register schedules without moving their gameplay into WS36:

```js
await clock.scheduleEvent({
  id: 'owner-defined-stable-id',
  kind: 'owner-defined-kind',
  at: { year: 1, month: 3, day: 10, hour: 20, minute: 0 },
  payload: { owner: 'wsXX' },
});
```

Handle the trigger via constructor injection:

```js
new WorldClockService({
  scheduleRepository,
  onScheduledEvent: async (event, context) => {
    // Route to the owning domain. Do not implement that domain here.
  },
});
```

## Persistence adapter contract

Implement outside WS36/without DB migrations:

```text
listPending(): ScheduledWorldEvent[]
upsert(event): void
markTriggered(eventId, metadata): void
```

Call `await clock.recoverSchedules()` during service startup before accepting normal world ticks.

## No integration changes performed

This branch intentionally does not modify WS14, WS24, WS25, WS28, client, admin/site, database migrations, or infrastructure implementation.
