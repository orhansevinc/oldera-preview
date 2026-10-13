# WS47 Status

Status: COMPLETE

Branch: `ws47-anticheat-signals`

Delivered:

- typed server-side anti-cheat signal model covering all requested signal families
- severity and rolling review-risk scoring
- sanitized evidence metadata with signal-specific allowlists
- session/correlation IDs and rule version metadata
- sliding time-window counters and configurable thresholds
- duplicate signal suppression without losing rate counts
- per-rule enable/disable, severity, points, aggregation and suppression configuration
- false-positive-conscious review-only disposition
- admin review adapter interface and in-memory reference adapter
- observability adapter with metadata-only output
- explicit raw packet/sensitive content exclusion
- duplicate serial hash-only evidence contract
- adapter failure isolation; no gameplay enforcement path
- Node test coverage and isolated GitHub Actions workflow

AUTO-BAN: NO. `autoAction` is always `none`; WS47 emits review signals only.

No client anti-cheat, file/process scanning, WS15 movement, WS17 items, WS19 combat, other product code, admin/site, or migrations were modified.
