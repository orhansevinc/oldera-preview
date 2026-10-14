# WS14 — Dependency Snapshot (2026-10-14)

Observed contracts used for the multi-zone lifecycle pass:

- WS03 `ws03-ko1298-session` HEAD `237c4a613e94434baae656c1399cb449e7b78067`
  - selected-character handoff remains `world.beginSelectedCharacter(...)`;
  - post-select world packet routing remains WS14-owned.
- WS15 `ws15-movement-sync` HEAD `ce9bed13b8d45c32ff0592595aa3a0d1e7b3964d`
  - `registerSession`, `teleport`, `disconnect` adapter contract;
  - teleport is a baseline reset, not a `WIZ_MOVE` packet.
- WS16 `ws16-npc-world` HEAD `e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2`
  - world owns region/session lifecycle and nearby entity orchestration;
  - WS16 owns NPC domain behavior, not WS14.
- WS24 `ws24-pvp-zone-rules` HEAD `4c95200b7e7eafda5f893bd62034d3727dcb9cbc`
  - zone entry must use `CanEnterZone`-style rule decision;
  - unknown/unmapped zones fail closed.
- WS25 `ws25-mob-ai` HEAD `ff1804a7d7a1328727924c50be39792d2caa2483`
  - WS14 consumes mob world snapshots/hooks only; no mob AI implementation here.
- WS27 `ws27-progression` HEAD `e984a73c3be8a7407bfc3a34907f3d3376134add`
  - progression resolves respawn destination; final world relocation belongs WS14/WS15 composition.
- WS31 `ws31-data-catalog` HEAD `a92ed73876be604273bc97e9d1faa68ac9cdc166`
  - 16 source-backed 1298 zone identities used in `data/zones.1298.json`.
- OpenKO-db pinned source `bec619466938d278339c30e5b1a4bff3c9413bab`
  - `ManualSetup/6_InsertData_ZONE_INFO.sql` used for map/spawn metadata where rows align.
- Open-KO/KnightOnline pinned source `7d6cf81093e142c928c2ac9510512b2b182178b5`
  - protocol constants and zone-ability behavior evidence.
- WS10 canonical Moradon PASS
  - run #26 / run id `38505039290`;
  - exact genuine client artifact remains authoritative for browser Moradon E2E.

WS14 implementation evidence:

- commit `40c748d72b3f5ccf13bbb5aace7abcae05fd25be`
- Actions run `38521440351`
- job `115711809894` — SUCCESS
- existing 14-test regression suite + 18 new multi-zone tests = 32 tests in the same workflow
- new synthetic load test runs 120 sessions through Moradon -> B -> Moradon.
