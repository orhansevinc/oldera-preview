WS04

# DEPENDENCY SNAPSHOT — 2026-10-14

## Self

- Workstream: `WS04` (existing Character Select/Create client workstream).
- Branch: `ws04-character-client`.
- Pre-control baseline: `fffbd9372b67c2aaef600f7e50595bec7e23fe88`.
- Present-starvation implementation commit: `0bcc2517b3a6712bedc4211ed77b239b31c1bf9a`.
- Final tested implementation commit: `6dfbf1203c58fd3ab474a32cdf81a5bbca527aea`.
- Owned runtime patch: `tools/ws04_character/patch_frame_capture.py`.

## Central control read from main

Reviewed read-only on 2026-10-14 before implementation:

- `coordination/MASTER_CONTROL.md`
- `coordination/BROADCAST.md`
- `coordination/WORKSTREAM_REGISTRY.md`
- `coordination/MORADON_CRITICAL_PATH.md`
- `coordination/TASK_QUEUE.md`
- `coordination/inbox/WS04.md`

## Native client/runtime pins used for WS04 validation

- OpenKO POSIX client: `97eb0ea20207afc0c360bfed6915113572711be3`.
- KO 1298 assets checkout in the WS04 validation run: `2055ee6ed77f1b5cfef23832dd5bc31909e14a66`.
- Emscripten resolved by the run: `6.0.12`.
- Corrected WS04 CI: run `38497667882`, job `115637059193`.
- WS04 evidence artifact: `11864965704`.
- Artifact zip SHA256: `4a74afe129b362e75c57ce8850a904953b79535ddf602d7ae8f2714573c34448`.

## Moradon providers/consumers read-only

### WS05

- Branch: `ws05-moradon-world`.
- Current relevant head inspected: `6ca101f3390e0a0f6b056afea99b45ec8d4f67be`.
- Read: current `STATUS.md`, `DEPENDENCY_SNAPSHOT.md`, `browser_moradon_driver.cjs`, `patch_moradon_client.py`, and workflow.
- Contract: writes the same `globalThis.WS04_CAPTURE_REQUEST` id and consumes the same native PPM/READY marker contract.
- Dependency state: diverged from final WS04; merge base is `fffbd9372b67c2aaef600f7e50595bec7e23fe88`.
- Required next action: consume final WS04 with ancestry preserved before the integrated Moradon rerun.

### WS10

- Current branch head inspected: `34c551518aad87a9fd03d392f193d354483c95a0`.
- Exact corrected harness commit used by WS50 evidence: `3c22e0e6907b74651589a18818bbcc7e930698b2`.
- Read: final Moradon E2E report, workflow, and browser driver.
- Integration constraint: the workflow requires resolved WS04 SHA to be an ancestor of resolved WS05 SHA and runs `tools/ws04_character/patch_frame_capture.py` from the WS05 provider worktree.
- Current request id in that harness: `1010`.

### WS50

- Current branch head inspected: `94715058fdedc0a4fbab3a5f5c2ab29602fe747b`.
- Corrected Moradon rehearsal: run `38490102763`, job `115625184048`.
- Artifact: `11862962736`, zip SHA256 `f3818772899d2db24c5a2e6d1c975757055a140f8fa40597f37602829d985d5c`.
- Provider WS04 in that rehearsal: old baseline `fffbd9372b67c2aaef600f7e50595bec7e23fe88`.
- Evidence result: zone/assets/terrain/shapes/local-player native render markers all passed in one run, then the run timed out waiting for `WS04_GL_CAPTURE id=1010 ok=1`.
- Root-cause evidence: request is issued after the render markers; later native/session callbacks still run, but no later Present consumes the request. This is the Present-only polling starvation fixed by final WS04.

## Capture contract snapshot

No consumer API change was introduced:

- Request: `globalThis.WS04_CAPTURE_REQUEST = <id>`.
- Completion: `globalThis.WS04_CAPTURE_READY === <id>`.
- Native output: `/ws04-frame-<id>.ppm`.
- Evidence marker: `WS04_GL_CAPTURE id=<id> ok=1` (now with additive `source=present|browser-timer`).
- File source: genuine `RHIDeviceGL::DumpFramePPM()` GL backbuffer readback.

## Regression snapshot

Final WS04 validation proves the hook still services normal Character Select/Create through pre-swap Present:

- Character Select native GL frame ratio: `0.8169`.
- Character Create native GL frame ratio: `0.6529`.
- Create-ready PPM also produced successfully.
- Real WarFare WASM configure/build passed.

The run's later character-model visual failure is caused by missing sparse-fixture `/data/item/upc_el_rm_*.n3cpart` files and is separate from frame capture.

## Single outstanding dependency

`WS05 must consume 6dfbf1203c58fd3ab474a32cdf81a5bbca527aea with ancestry preserved, then WS10/WS50 must rerun the corrected native Moradon E2E.`

WS04 has no known remaining code change before that rerun.

`BU SOHBETE ARTIK GEREK VAR MI?: HAYIR — sonraki işlem WS05/WS10/WS50 entegrasyon zincirindedir.`
