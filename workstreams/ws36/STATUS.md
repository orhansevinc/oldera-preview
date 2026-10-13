# WS36 Status

## State

TAMAMLANDI

## Scope delivered

- Authoritative timezone-independent 1.298 game clock.
- Exact 6-second real tick -> 1 game-minute progression.
- Legacy 30-day month / 12-month calendar rollover.
- `WIZ_TIME (0x13)` broadcast contract.
- Real 1.298 weather set only: clear/rain/snow.
- `WIZ_WEATHER (0x14)` broadcast contract and weather intensity validation.
- Reproduced 1.298 automatic hourly weather transition thresholds.
- No invented server-side day/night enum; client sky remains driven by game-time packet.
- Deterministic scheduled world-event trigger interface with stable ordering.
- Restart recovery repository port plus in-memory reference adapter.
- Default backwards-time rejection and protected explicit forced rewind.
- Controlled `setTime` / `setWeather` interfaces for a future WS28 adapter.
- Deterministic Node tests and dedicated GitHub Actions workflow.

## Excluded by design

- No WS14 implementation changes.
- No WS24 zone/battle rule changes.
- No WS25 mob changes.
- No WS28 command-bus changes.
- No concrete new world events.
- No DB migration or persistence implementation.
- No client/admin/site changes.

## Test command

```bash
node --test tests/ko1298-world-clock/*.test.cjs
```

## Compatibility references

Behavior was cross-checked against OpenKO 1.298-compatible packet definitions, client time/weather receive handlers, and Ebenezer game-time/weather routines.
