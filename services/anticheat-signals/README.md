# @oldko/anticheat-signals

Server-side suspicious-state signal framework for OldKOWeb.

The library converts already-validated server observations into typed, rate-limited, duplicate-suppressed review signals with a rolling risk score. It has no client inspection capability and no automatic enforcement path.

## Usage

```js
import { AntiCheatSignalEngine, SIGNAL_TYPES } from './src/index.js';

const engine = new AntiCheatSignalEngine({ reviewAdapter, observability });
await engine.record({
  type: SIGNAL_TYPES.IMPOSSIBLE_MOVEMENT,
  subject: { kind: 'character', id: characterId },
  sessionId,
  correlationId,
  source: 'movement-service',
  evidence: { observedSpeed, maxSpeed, elapsedMs, reasonCode: 'speed_envelope' }
});
```

Integrators must emit observations only after their own authoritative validation. See `ANTICHEAT_SIGNAL_MODEL.md` and `workstreams/ws47/INTEGRATION_PATCH.md`.

Run tests with `node --test tests/anticheat-signals/*.test.mjs` from repository root, or `npm test` from this package directory.
