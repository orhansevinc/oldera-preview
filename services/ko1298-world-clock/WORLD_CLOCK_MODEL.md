# OldKO 1.298 World Clock / Weather Model

## Scope

WS36 owns only the authoritative game clock, the 1.298 weather state, deterministic schedule triggering, and integration ports. It does **not** own world sessions (WS14), PvP/zone rules (WS24), mob logic (WS25), command-bus implementation (WS28), persistence migrations, client rendering, or concrete world-event rules.

## 1.298 evidence and compatibility choices

The model intentionally follows the OpenKO project whose stated target is official-client-compatible Knight Online 1.298/1.299 behavior.

Observed 1.298 protocol/server behavior:

- `WIZ_TIME = 0x13` and the client consumes five signed 16-bit values: year, month, day, hour, minute.
- `WIZ_WEATHER = 0x14` and the client consumes weather type plus a percentage/amount.
- The only protocol weather types are `FINE/CLEAR = 1`, `RAIN = 2`, `SNOW = 3`.
- Ebenezer advances `m_nMin` from a 6-second timer: one game minute per six real seconds.
- At minute 60 Ebenezer increments the hour, resets minute to zero, updates weather, and persists game-time fields.
- The legacy calendar rolls `day 30 -> day 1/month + 1` (`m_nDate == 31`) and `month 12 -> month 1/year + 1` (`m_nMonth == 13`). This is intentionally **not** a Gregorian calendar.
- Automatic weather selection uses a 0..100 roll: `<2` snow, `<7` rain, otherwise clear. The amount is another 0..100 roll. For clear weather, amount <=70 becomes 0; otherwise it is halved. The original client interprets clear-weather amount as fog amount.
- The client applies received time directly to its sky manager (`SetGameTimeWithSky`). Therefore WS36 does not invent a separate server-side `DAY/NIGHT` enum or day/night thresholds.

Primary reference paths in `Open-KO/KnightOnline`:

- `src/shared/packets.h`
- `src/Client/WarFare/GameProcMain.cpp` (`MsgRecv_Time`, `MsgRecv_Weather`)
- `src/Server/Ebenezer/EbenezerApp.cpp` (`GameTimeTick`, `UpdateGameTime`, `UpdateWeather`, `SetGameTime`)

## Authoritative time representation

Internal time is a timezone-free game calendar tuple:

```text
{ year, month, day, hour, minute }
```

No `Date`, local timezone, UTC offset, DST, or host wall-clock conversion is used. Ordering uses a serial game-minute number based on the fixed 1.298 calendar (12 months x 30 days x 24 hours x 60 minutes).

This makes deterministic replay and test fixtures independent of the machine timezone.

## Clock progression

`GAME_TICK_REAL_MS = 6000`.

The domain exposes both:

- `advanceTick()` — exactly one 1.298 game minute.
- `advanceRealMilliseconds(ms)` — deterministic accumulation for hosts that feed monotonic elapsed time.

WS36 intentionally does not start its own timer thread. The runtime host remains responsible for scheduling ticks, which keeps tests deterministic and prevents hidden lifecycle coupling.

## Time broadcast port

`getTimeBroadcast()` returns the WS14-facing contract:

```js
{
  opcode: 0x13,
  year,
  month,
  day,
  hour,
  minute
}
```

`broadcastCurrentState()` publishes time and weather through injected callbacks. This is suitable for session/bootstrap integration without importing WS14 implementation.

Automatic hourly clock ticks do **not** manufacture a `WIZ_TIME` broadcast cadence that is not proven by the 1.298 Ebenezer source. Hourly automatic behavior broadcasts weather, while WS14 can request the current time packet when a session needs it. Controlled GM `setTime()` publishes the changed time immediately through the same port.

## Weather model

Allowed states:

```text
CLEAR = 1
RAIN  = 2
SNOW  = 3
```

Each state also contains `intensity: 0..100`.

`roll1298Weather()` reproduces the old Ebenezer random transition rules. Randomness is injected, allowing deterministic tests. No cloudy/storm/fog weather type is added. Fog remains only the clear-weather amount semantics observed in the original code.

`setWeather()` is the controlled WS28/GM-facing domain interface. It validates the same real 1.298 weather set and publishes via the weather port; it does not implement a GM command or panel.

## Backwards-time protection

Normal `setTime()` rejects any backwards change with code `BACKWARDS_TIME_NOT_ALLOWED`.

A privileged integration may explicitly pass `allowBackward: true`. This is intentionally noisy and carries optional `actor`/`reason` metadata. Even then, the deterministic scheduler keeps a monotonic high-watermark so already processed world-event windows are not replayed when game time is rewound.

## Deterministic scheduled world events

WS36 provides a scheduler, not concrete event gameplay.

A scheduled event contains:

```js
{
  id: string,
  kind: string,
  at: { year, month, day, hour, minute },
  payload: any
}
```

Due events are ordered by:

1. serial game minute
2. event id (stable tie-breaker)

The injected `onScheduledEvent(event, context)` callback is the only trigger interface. Concrete battle/zone/mob/event behavior stays in its owning workstream.

## Restart recovery repository port

The scheduler requires only:

```text
listPending()
upsert(event)
markTriggered(eventId, metadata)
```

No DB schema is included. A future persistence adapter can implement this port. `InMemoryScheduleRepository` exists only as a reference adapter and for deterministic tests.

Triggered events are removed from the in-memory pending set only after the trigger callback succeeds and the repository is marked. A failed callback therefore remains pending for a later retry.

## Integration boundaries

- **WS14**: consume `getTimeBroadcast()`, `getWeatherBroadcast()`, or injected broadcaster callbacks; never mutate WS36 state directly.
- **WS28**: call `setTime()` / `setWeather()` through a thin adapter; do not import internals.
- **WS24/WS25/other event owners**: register event definitions through `scheduleEvent()` and consume `onScheduledEvent` callbacks; WS36 never decides battle, spawn, reward, or zone semantics.
