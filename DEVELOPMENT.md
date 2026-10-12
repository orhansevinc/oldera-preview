# OldERA 1298 — continuation checkpoint

Current work continues the existing `orhansevinc/oldera-preview` GitHub Pages project. Do not replace it with the unrelated early Sites prototype.

## Required experience

Use original 1298 assets and UIF layouts. Preserve launcher → login → server → first-time nation selection → character selection/creation → Moradon. No invented intermediate pages. Keep the launcher mask inside the right content rectangle.

Test profiles are `osevinc / osevinc` (existing El Morad character) and `osevinc1 / osevinc1` (initially empty). They are local browser profiles, not real server accounts. Nation and all three slots persist in localStorage, with migration from the previous single-character keys.

## This update (v19)

- Fixed the strict-mode undeclared variable that stopped the character-selection render loop on its first frame.
- Isolated asynchronous scene instances, guarded cancelled loads, and disposed abandoned character geometry/materials.
- Rendered the bounded character creation preview above the opaque UIF tiles. Creation preview uses game skeletons and idle clips; selection keeps the original shared selection-animation mappings.
- Replaced DOM observers, credential rewriting and single-slot monkey patches with explicit profile and screen state.
- Resolved UI paths using the exact 1298 directory filenames, including mixed-case atlases and the legacy login atlas reference.
- Used original loading UIF progress controls driven by world loading events; retained load failures instead of presenting false completion.
- Connected the selected character's actual meshes and idle/walk/run clips to the existing Moradon scene.
- Updated entry and module version parameters to v19.

## Verification

`node --test tests/profile1298.test.cjs`

Additional checks in the editing session used original binary assets and a Node DOM/canvas harness: both nation/loading layouts, first-time login and return login, bonus-point validation, creation in multiple slots, deletion of only the selected slot, account isolation, cancellation of stale scene loads, seven races' mesh/animation data, original idle/walk/run clips, and world lifecycle/progress callbacks. The WebGL renderer was stubbed in these checks. Full browser/WebGL visual QA was unavailable in that session; pixel-perfect appearance is not yet verified.

## Remaining work

Moradon still uses the existing height-derived terrain color rather than decoded `.gtt` ground layers. NPC interaction, collision, trade/inventory state, combat, network transport, server authentication, and other maps are incomplete. Launcher Homepage/Option do not yet have implementations. Do not describe this build as a complete 1298 game or a verified exact visual replica.

Original assets: `https://github.com/ko4life-net/ko-assets/tree/1298`.
Engine references checked: `ko4life-net/ko` — `GameProcCharacterSelect.cpp`, `GameProcCharacterCreate.cpp`, `PlayerMySelf.cpp`, `N3UIBase.cpp`, `N3UIProgress.cpp`, `N3Joint.cpp`, `N3Skin.cpp`, and `N3Chr.cpp`.
