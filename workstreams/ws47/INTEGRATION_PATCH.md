# WS47 Integration Patch

## Purpose

WS47 is a runtime security-signal contract only. It does not modify movement, combat, item, economy, session, packet, admin, or client implementations.

## Integration points

Authoritative services may construct an `AntiCheatSignalEngine` and call `record()` after their normal validation rejects or detects an impossible state.

Recommended producers:

- movement/world validation -> `impossible_movement`, `repeated_invalid_position`
- combat validation -> `impossible_attack_range`, `impossible_attack_frequency`, `invalid_skill_request`
- item/inventory/inn validation -> `invalid_item_ownership`, `duplicate_serial_detection`
- economy validation -> `impossible_coin_transaction`
- session/protocol edge -> `repeated_malformed_packet_metadata`, `suspicious_reconnect_pattern`
- domain command handlers -> `excessive_failed_actions`

## Required producer behavior

1. Preserve the producer's authoritative gameplay rules; WS47 must not become the source of truth for movement/combat/items/economy.
2. Emit only after legitimate transitions (teleport/zone change/reconnect/retry/rollback/etc.) have been excluded by the producer.
3. Pass packet metadata only. Never pass raw payload/body/bytes, credentials, chat text, tokens, cookies, or client machine data.
4. For duplicate item serials, pass a server-side derived `serialHash`, never the raw serial.
5. Use stable server-side `sessionId` and `correlationId` when available.
6. Treat `risk.rollingScore` as review prioritization only. Do not bind it to ban/kick/mute logic.

## Admin review adapter

Implement an object with:

```js
{ async submit(signal) { /* enqueue/store sanitized signal */ } }
```

The adapter is intentionally abstract so a future admin API/queue can consume signals without WS47 editing admin product code.

## Observability adapter

Implement:

```js
{ emit(eventName, fields) { /* metric/log/trace sink */ } }
```

The built-in engine sends summary metadata only and never forwards the evidence object to observability output.

## Configuration

Use constructor `rules` overrides to tune thresholds/windows per environment. Begin with defaults and tune from real false-positive data before increasing severity or lowering thresholds.

## Merge guidance

The branch is self-contained under the WS47 allowlist. It can be merged independently. Producer wiring should happen later in the owning workstreams/integration branch rather than by modifying WS15/WS17/WS19 or other product code here.
