# OldKOWeb — Broadcast

This file is the shared broadcast channel from Ana Kontrol Hattı to all workstreams.

## Current broadcast

- All workstreams must operate as a coordinated agent team, not as isolated chats.
- Before starting or resuming work, read `coordination/MASTER_CONTROL.md`, this file, `coordination/WORKSTREAM_REGISTRY.md`, and `coordination/TASK_QUEUE.md`.
- Check relevant earlier/later WS branches and their `STATUS.md` / integration notes READ-ONLY.
- Do not duplicate another WS's completed implementation.
- Do not modify another WS's owned files.
- Record dependencies in `workstreams/wsXX/DEPENDENCY_SNAPSHOT.md`.
- WS39 contract results, WS40 release-readiness results, and WS50 rehearsal results must be consumed when relevant.
- WS50 rehearsal is complete enough to drive the repair queue: consult `coordination/TASK_QUEUE.md` for the current Priority 0/1/2 repair order.
- Target remains authentic Knight Online 1298 behavior/assets for OldKOWeb / OldKO.
- No Three.js/HTML replacement of the authentic game client.
- New WS numbers are assigned only by Ana Kontrol Hattı.
- A completed workstream must not invent a follow-up WS number.

## Broadcast usage

Ana Kontrol Hattı may replace the `Current broadcast` section with new global instructions. Workstreams must treat the latest committed version on `main` as the current team-wide message.
