WS49

# STATUS — Immutable Moradon NPC/Mob Visibility Gate

DURUM: **C5 GATE IMPLEMENTED / CI VERIFYING**

Canonical provider set consumed without branch-HEAD resolution:
`WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e`

Manifest source is pinned to WS50 commit `0d5001095fa3b43693b4fa0cda615f84e2cb7df5`; the gate verifies the canonical content hash before staging exact provider SHAs. No provider branch tip is resolved or substituted.

Gate scope is only the first playable milestone: Moradon NPC/mob visibility. Production PASS requires real WS16 NPCs, real WS25 mobs, real WS14 world/wire composition, exact WS11 protocol fixtures and the pinned real Moradon SMD authority. Synthetic fixtures cannot substitute for the production visibility result.

Deterministic acceptance exercised:
- login/world-ready regression on exact C5 WS03;
- movement regression on exact C5 WS15;
- real NPC and mob 0x1C region identities;
- mixed NPC/mob 0x1D detail recovery;
- NPC and mob 0x0A IN/OUT;
- authoritative XYZ;
- 37 NPC + 135 mob shared runtime identity uniqueness and zero cross-domain collision;
- source-backed region crossing with old entity OUT and new entity discovery/detail;
- reconnect identity stability with no duplicate/stale IDs;
- malformed/unknown detail request fail-safe behavior;
- two players at the same authoritative position receive identical visibility state.

Final PASS is contingent on the branch workflow being GREEN; evidence artifact is `ws49-c5-moradon-visibility` and is bound to the exact immutable provider-set key above.
