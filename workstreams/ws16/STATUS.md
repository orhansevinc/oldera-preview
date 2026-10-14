WS16

# STATUS

DURUM: READY_FOR_INTEGRATION — verified Moradon population/lifecycle layer implemented; exact terrain source and exact interaction-distance constant remain external integration inputs.

## Verified population

- Patch/data target: KO 1298 / Moradon zone 21.
- Source pin: `Open-KO/OpenKO-db@bec619466938d278339c30e5b1a4bff3c9413bab`.
- `K_NPC` verified templates: **31 unique SIDs**.
- `K_NPCPOS` verified static spawn groups in zone 21: **39**.
- Source-declared `NumNPC` population across those groups: **43**.
- Deterministic path anchors safe to materialize without inventing X/Z: **37**.
- Two groups (`16082`, `16083`) have source rows with rectangles but no path point and remain catalog-only until a real placement resolver is available.
- ActType=1 monster rows are intentionally excluded from WS16 NPC population.

Machine-readable source: `world-data/npc/moradon.json`. Every template/spawn record carries its exact source-row key; the catalog pins the corresponding `K_NPC` / `K_NPCPOS` source refs once at top level.

## Runtime / interaction

Implemented:

- template/instance separation;
- static/merchant/quest/gate/inn/other classification;
- terrain+shape Y resolver port with fail-closed unresolved height;
- spawn/despawn lifecycle events;
- 48-unit 3x3 nearby region query;
- region enter/stay/leave diff + packet resync;
- target/select and authoritative HP response;
- wrong-zone validation;
- configurable/fail-closed interaction distance validation;
- explicit disabled/dead interaction rejection;
- standardized interaction result envelope;
- verified merchant handoff port -> WS22 boundary;
- verified Inn Hostess handoff port -> WS33 boundary;
- quest handoff port -> WS23 boundary (seed candidates remain disabled until EVT semantics are verified);
- gate/world-transition port -> WS14 boundary (Aban identity verified; destination/action unresolved);
- concurrent multi-player interaction with no shared per-interaction mutable state;
- runtime ID collision rejection;
- idempotent zone reload;
- data duplication/provenance validation;
- malformed packet fail-closed handling.

## Terrain Y evidence

`K_NPCPOS` stores X/Z/path/bounds but no Y. Open-KO/KnightOnline 1.298 client source resolves terrain height and shape height at runtime and uses the higher result. WS16 mirrors that policy through `createTerrainHeightResolver()` but does not own terrain assets/parsing.

## Tests

Local Node 20-compatible suite: **29/29 PASS**.

Coverage includes packet layout/parsers, verified catalog stats, duplication rejection, terrain resolution, spawn/despawn, region delta, nearby IDs, reload idempotency, merchant/quest/inn/world ports, range/zone/dead/disabled rejection, target HP, detail zone filtering, two players on one NPC, runtime-ID uniqueness, 180-NPC region simulation, malformed packet fuzz and despawn/resync.

CI: `.github/workflows/ws16-npc.yml` runs `node --test tests/ko1298-npc/*.test.js` on branch push/PR.

## UNKNOWN / blockers

1. Exact Moradon terrain/shape-height provider is not owned by WS16; real Y values must come from the verified zone runtime/assets.
2. Exact KO 1298 **server** interaction-distance threshold is not source-verified; production must inject a verified range/policy. Default is fail-closed.
3. Individual coordinates for extra members of `NumNPC > 1` groups are not explicitly present in `K_NPCPOS`; WS16 materializes one verified path anchor rather than cloning guessed positions.
4. `16082`/`16083` lack path points; their source-row provenance is retained but deterministic placement is unresolved.
5. Exact EVT semantics for quest-like byTypes and Aban's gate destination are not verified, so those interaction routes remain fail-closed even though NPC identity/spawn data is verified.
6. `Miraselth[Warehouse Keeper]` byType 29 and `Selith[Special Store]` byType 23 need owning-domain semantics before interaction routing is enabled.

## Handoff

- WS14: use `NpcWorld.nearby()` for world snapshots; consume `worldTransition` only after gate event/destination is verified.
- WS15: call `regionSync()`/`regionDelta()` after authoritative region crossing; WS16 does not own movement.
- WS22: merchant route is source-verified for `sellingGroup > 0`; keep prices/items authoritative in WS22/WS17.
- WS23: consume authoritative template identity only after EVT/action mapping is verified.
- WS33: SID 12000 Inn Hostess is verified and may route to `createInnHostessHandler()`.
- Integration/terrain owner: provide terrain+shape height resolver and verified interaction-range policy.
