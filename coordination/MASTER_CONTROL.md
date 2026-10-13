# OldKOWeb — Master Control Protocol

This repository is developed by parallel workstreams named `WS01`, `WS02`, ...

## Non-negotiable identity rule

Each workstream keeps its assigned WS number for its entire lifetime. It MUST NOT rename itself or allocate a new WS number. Only the Ana Kontrol Hattı assigns new WS numbers.

## Mandatory startup protocol for every WS

Before doing implementation work, every workstream MUST:

1. Read `coordination/MASTER_CONTROL.md`.
2. Read `coordination/BROADCAST.md`.
3. Read `coordination/WORKSTREAM_REGISTRY.md`.
4. Inspect its own branch and `workstreams/wsXX/STATUS.md` if already present.
5. Identify all upstream/downstream workstreams relevant to its task.
6. Read those workstreams' `STATUS.md`, `INTEGRATION_PATCH.md`, `BUGS.md`, contract docs, or branch state READ-ONLY when available.
7. If WS40 output exists, read release/readiness and merge-order information relevant to the task.
8. If WS50 output exists, read rehearsal/conflict/safe-batch information relevant to the task.
9. Create or update `workstreams/wsXX/DEPENDENCY_SNAPSHOT.md` with the evidence used.
10. Do not reimplement work already owned by another WS.

## Cross-workstream awareness

A workstream must know:

- what it owns;
- what it explicitly does not own;
- which WS provides each dependency;
- which WS consumes its outputs;
- whether those dependencies are `TAMAMLANDI`, `DEVAM EDİYOR`, `PARTIAL`, `FAIL`, or `UNKNOWN`;
- the exact branch/commit/interface used when known.

A dependency being incomplete is not permission to edit that dependency's files. Use interfaces/mocks/adapters and record the unresolved dependency.

## File ownership rule

Each WS may only modify paths explicitly assigned in its prompt. If another WS file needs a change, do not edit it. Record the requested change in:

`workstreams/wsXX/INTEGRATION_PATCH.md`

or, for discovered defects:

`workstreams/wsXX/BUGS.md`

## Shared source of truth

Priority order for coordination information:

1. Latest explicit Ana Kontrol Hattı instruction.
2. `coordination/BROADCAST.md`.
3. `coordination/MASTER_CONTROL.md`.
4. `coordination/WORKSTREAM_REGISTRY.md`.
5. Relevant workstream `STATUS.md` / contracts / integration notes.
6. Historical prompt text.

If sources conflict, do not guess. Record the conflict and follow the highest-priority source.

## Completion protocol

A workstream may say `TAMAMLANDI` only when:

- its required deliverables exist;
- its own branch contains the final commit;
- tests were actually run;
- `workstreams/wsXX/STATUS.md` is current;
- dependencies/blockers are listed;
- integration notes are listed;
- the final commit SHA is reported.

Completed workstreams must end with:

`BU SOHBETE ARTIK GEREK VAR MI?: HAYIR`

unless there is a concrete unresolved task that specifically requires that same workstream. A completed workstream does not allocate a successor WS number.

## Integration rules

- No workstream merges to `main` unless explicitly assigned that exact integration role by Ana Kontrol Hattı.
- No force push.
- No silent conflict resolution in another owner's code.
- Interfaces/contracts are preferred over cross-WS implementation edits.
- WS39 is the contract/compatibility authority for cross-service contract checking.
- WS40 is the release-readiness / merge-order planning authority.
- WS50 is the isolated merge-rehearsal authority.
- Ana Kontrol Hattı is the final coordination authority.

## Dependency snapshot minimum format

Every active WS should maintain `workstreams/wsXX/DEPENDENCY_SNAPSHOT.md` containing at least:

- `SELF`: WS number, branch, current commit.
- `UPSTREAM`: WS number, branch, status, commit/interface used.
- `DOWNSTREAM`: known consumers.
- `CONTRACTS`: contract/schema/version relied on.
- `BLOCKERS`: unresolved external dependencies.
- `LAST_SYNC`: repository evidence checked.

## Core project invariant

Project: **OldKOWeb**
Game: **OldKO**
Target: **authentic Knight Online 1298 behavior and assets**.

Do not replace the authentic client with a Three.js/HTML recreation. Do not silently import modern KO systems into the 1298 target.