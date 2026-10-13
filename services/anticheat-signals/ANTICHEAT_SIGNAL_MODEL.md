# Anti-Cheat Signal Model

WS47 defines a server-side suspicious-state **signal** contract. A signal is evidence for review, not proof of cheating and never an enforcement command.

## Boundary

Only facts already visible to authoritative server systems may enter this library: movement validation results, position validity, attack/skill validation results, item ownership/serial checks, coin invariants, packet **metadata**, reconnect/session timing, and failed-action counts.

Explicitly out of scope: client file scanning, process enumeration, spyware, device inspection, raw packet capture, chat/message capture, passwords, tokens, cookies, and automatic bans.

## Signal schema

```text
schemaVersion: 1
signalId: unique opaque ID
type: one of the WS47 typed signal names
severity: info | low | medium | high | critical
observedAt: ISO-8601 UTC timestamp
subject: { kind, id }
sessionId: optional server session ID
correlationId: optional request/trace correlation ID
source: server component name
rule: { id, version }
evidence: allowlisted metadata only
aggregation: { occurrenceCount, threshold, windowMs, firstSeenAt, lastSeenAt }
risk: { points, rollingScore, windowMs }
disposition: admin_review
autoAction: none
```

`rollingScore` is capped at 100 and is only a prioritization hint for reviewers. It MUST NOT be interpreted as a ban threshold.

## Signal types

- `impossible_movement`
- `repeated_invalid_position`
- `impossible_attack_range`
- `impossible_attack_frequency`
- `invalid_skill_request`
- `invalid_item_ownership`
- `duplicate_serial_detection`
- `impossible_coin_transaction`
- `repeated_malformed_packet_metadata`
- `suspicious_reconnect_pattern`
- `excessive_failed_actions`

## Evidence privacy

Evidence is signal-specific and allowlisted. Unknown keys are dropped. The malformed-packet signal may retain only metadata such as opcode, declared/actual length, direction, and a short reason code; packet payload/body/bytes are never retained. Duplicate serial detection stores only a derived `serialHash`, never the raw serial value.

Downstream adapters must treat `subject.id`, `sessionId`, and `correlationId` as operational identifiers and apply normal log retention/access controls.

## Rate aggregation and suppression

Each rule has an aggregation window and threshold. Low-confidence observations such as invalid positions, malformed packet metadata, reconnect churn, and failed actions must accumulate before a signal is emitted. After emission, a suppression window prevents alert floods while observations continue to contribute to the rate counter.

## False-positive policy

Rules are intentionally conservative. The producing domain remains responsible for deciding that an observation is objectively invalid under its authoritative rules. WS47 does not infer client intent. Network jitter, server stalls, teleports, zone transfers, buffs/debuffs, animation timing, item transfers, rollback/retry paths, and reconnect recovery must be accounted for by the producing service before calling WS47.

Every signal remains review-only. Operators should correlate multiple independent signals and domain evidence before taking account action.

## Adapter contracts

`AdminReviewAdapter.submit(signal)` receives the sanitized signal for a future admin review queue. `ObservabilityAdapter.emit(name, fields)` receives only low-cardinality metadata summaries; the default engine never sends the evidence object to observability output.

Adapter failure does not alter gameplay and does not trigger enforcement. It is surfaced as `anticheat.review_adapter_error`.
