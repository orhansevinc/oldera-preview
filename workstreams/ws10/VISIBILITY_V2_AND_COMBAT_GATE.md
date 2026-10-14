# WS10 — Visibility Gate V2 + Playable Combat Gate Harness

## Why V2 exists

Historical WS50-C5 / WS10 visibility automation is retained as historical evidence. It proved real KO1298 network detail records, entity creation, authoritative model resolution, entry into `CPlayerBase::Render()`, and a genuine non-black native GL framebuffer. It did **not** prove that any specific NPC or mob occupied a valid on-screen projected area or produced pixels visible to a human. A generic non-black frame can therefore coexist with invisible NPCs/mobs.

V2 is a separate product-acceptance gate. It does not change or delete C5 artifacts and it does not redefine the old gate retroactively.

## Visibility V2 acceptance chain

For at least one authoritative real NPC and one authoritative real mob, the **same runtime ID** must survive all of:

`network record -> entity create -> authoritative model -> valid native world bounds -> camera front -> native frustum -> clipped viewport bounds -> native draw submission -> entity-specific native framebuffer pixel delta -> native screenshot`

The native probe is observation-only. It uses `CPlayerBase::Min()/Max()` after the model transform, the live `CN3Base::s_CameraData`, the engine frustum, the engine's 3D-to-2D projection helper, and GL framebuffer reads immediately before/after the real `m_Chr.Render()` call. Invalid/non-finite transforms, zero-size bounds, behind-camera entities, fully clipped entities, and draw calls that produce no entity-specific pixel delta cannot pass.

`WS10_VISIBILITY RENDERED` and `WS10_VISIBILITY_CAPTURE_OK` remain useful historical diagnostics but cannot satisfy V2.

No HTML/DOM labels, Canvas2D/Three.js entity replacement, synthetic entity, packet substitution, or renderer substitution is accepted.

## Immutable provider-set rule

Every V2/manual run receives an exact manifest commit, manifest path and immutable key. `lock-provider-set.cjs` recomputes the WS50 canonical content hash, verifies the immutable key, and extracts exact provider SHAs. The workflow stages those SHAs directly; it does not resolve provider branch tips during a run.

The V2 workflow is intentionally separate from `.github/workflows/ws10-ws50-visibility.yml`, so historical C5 evidence and artifacts stay untouched.

## Playable combat gate contract

The combat harness is prepared for the next immutable provider set but fails closed until the provider set declares the required providers and composition capabilities. Current visibility-only sets may legitimately return `BLOCKED`.

Required correlation is:

- target: real mouse click -> native hit-test runtime ID -> native current target ID -> native target HP UI -> authoritative server target;
- normal attack: real keyboard/mouse input -> exact `WIZ_ATTACK (0x08)` C2S bytes -> authoritative server combat result -> WS11-authoritative S2C bytes -> native attack state/animation -> native target HP decrease;
- skill: native available skill/icon -> real keyboard input -> exact `WIZ_MAGIC_PROCESS (0x31)` C2S -> authoritative server skill result -> WS11-authoritative S2C -> native client effect -> native mana/resource decrease -> target HP/effect change;
- death: one authoritative server death -> native death state/animation -> not attackable -> OUT when required -> authoritative respawn -> IN -> V2-grade human-visible respawn.

Mob retaliation is recorded when available but is not a hard gate until its provider contract is authoritative.

## Real-input-only boundary

`real-browser-input.cjs` exposes only Playwright mouse/keyboard primitives. The gameplay harness is statically checked to reject direct `page.evaluate()` gameplay calls, Emscripten `ccall/cwrap`, exported `Module._*` game methods, damage injection, and HP-memory mutation. Observability may read logs/framebuffer; it may not cause gameplay outcomes.

## Current readiness snapshot (task start)

- WS10: `163f2ebf81e750bf746fdaa277695329a0682e22`
- WS05: `0537c481383a69c534799b43810f35e7279c5578`
- WS11: `944b6ff9b6329af29f1048a74aa6e14fca141639`
- WS19: `28eb4f38753ffbc54c60abbd2a32832301284c06`
- WS25: `13c9bafe287b250d56b52f19e97a02e7ef18e6e5`
- WS31: `546d2ab62cd46a97f3385ebcddbe0c775a02c2eb`

Historical C5 does not include WS19 as a provider and does not declare the five playable-combat capabilities consumed by `combat-readiness.cjs`; it must therefore be `BLOCKED`, never a fabricated combat PASS.

## Harness files

- `qa/moradon/v2/lock-provider-set.cjs` — immutable provider-set lock.
- `qa/moradon/v2/patch_visibility_observability_v2.py` — native bounds/frustum/render/pixel probe.
- `qa/moradon/v2/browser-e2e-v2.cjs` — real-browser visibility flow and native screenshot capture.
- `qa/moradon/v2/verify-visibility-v2.cjs` — runtime-ID-correlated V2 acceptance.
- `qa/moradon/v2/real-browser-input.cjs` — gameplay input-only boundary.
- `qa/moradon/v2/combat-readiness.cjs` — PREPARED/BLOCKED decision from immutable manifest.
- `qa/moradon/v2/playable-combat-browser.cjs` — real-browser target/attack/skill/death/respawn evidence collector.
- `qa/moradon/v2/verify-combat-evidence.cjs` — full combat correlation gate.
- `qa/moradon/v2/*selftest.cjs` — false-positive regression and fail-closed tests.
- `.github/workflows/ws10-visibility-v2.yml` — separate parameterized V2 workflow.
