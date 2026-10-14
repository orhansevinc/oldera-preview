# WS31 DATA PROVENANCE

Parser: `ws31-generator/2.0.0`

Pinned sources:
- Open-KO/KnightOnline `7d6cf81093e142c928c2ac9510512b2b182178b5` — loader/struct semantic corroboration.
- Open-KO/ko-client-assets `b4636332c7cd818b0ce171eccc973dd3d6b2e56d` — 1298 client tables.
- Open-KO/OpenKO-db `bec619466938d278339c30e5b1a4bff3c9413bab` — server schema and seed rows.

## ITEM FIELD NORMALIZATION

The pinned `ITEM` SQL header contains `ReqIntel` for the requirement and `IntelB` for the intelligence bonus.
The pinned server evidence maps `IntelB` to `IntelligenceBonus`.
The generator therefore uses an explicit semantic-to-source schema map (`intelligence_bonus -> IntelB`); it does not accept `IntB`, guess aliases, or default missing required fields to zero.

The client item CSV uses numbered/type headers rather than server semantic names. Its required index/type positions are validated before resource/model references are read.

## IDENTITY / RUNTIME BOUNDARY

K_NPCPOS rectangles, counts, paths and source row hashes are source authority.
Terrain Y is not in K_NPCPOS and remains runtime-resolver dependent.
WS25 deterministic rectangle expansion is a runtime projection and is not described as original 1298 RNG positions.
Runtime entity IDs are outside this catalog; source identity and runtime identity are not conflated.

Unknown or contradictory references remain in `data-catalog/generated/unresolved.json` and are never promoted to VERIFIED by inference.
