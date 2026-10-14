# Final Moradon E2E rerun request

Triggered after WS05 dependency synchronization consumed WS04 native capture fix with ancestry preserved.

Expected provider refs at rerun start:
- WS04: ws04-character-client (final native capture fix)
- WS05: ws05-moradon-world (merge descendant containing WS04 fix + native zone 210 Moradon gate)

Run the unchanged WS10 Moradon E2E gate and record PASS/BLOCKED with the first true blocker only.
