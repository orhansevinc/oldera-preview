# WS50 Moradon Visibility Candidate — C5

Parent remains immutable: `WS50-C4@sha256:9ab09b5c0e819b6379a3a9152f1e7eafd50df9eeeb3db8946638fd95008f3049`.

New child: `WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e`.

Only provider delta from C4:

- WS14 -> `ed5f806ce7505f4dfae406e4164735def63b6c86` (exact current visibility composition, CI `38598444290` SUCCESS)
- WS25 -> `13c9bafe287b250d56b52f19e97a02e7ef18e6e5` (integer runtime visibility authority, CI `38592973058` SUCCESS)

WS11, WS16, WS03, WS15, WS31, browser/runtime baseline and the canonical passing client artifact remain exactly inherited from C4.

C5 is valid only if the immutable provider-set workflow reproduces the real provider composition: real Moradon SMD -> real WS16 NPC materialization -> shared signed-i16 KO1298_NPC runtime namespace -> real WS25 MobVisibilityService with 135 mobs -> WS14 unified 0x1C -> mixed NPC/mob 0x1D detail recovery -> 0x0A IN/OUT -> WORLD_READY -> movement regression -> disconnect cleanup.

No synthetic substitute and no branch-HEAD re-resolution is accepted as C5 evidence. Browser proof remains intentionally false until WS10 consumes this exact immutable key.
