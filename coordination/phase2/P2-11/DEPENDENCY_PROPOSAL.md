# P2-11 dependency proposal

`coordination/phase2/CHARTER.md`, `OWNERS.json` and `CONTRACTS.md` were absent from the pinned Phase-2 base, so P2-11 proposes the following integration boundary for P2-00 to ratify.

- **P2-11 owns** the one PostgreSQL `oldko` persistence schema, forward-only canonical migration ordering/checksums, generic serializable transaction/repository surfaces, account/character persistence foundations, distinct admin identity persistence, runtime config persistence, heartbeat-backed status persistence and runtime-result proof records.
- **P2-00 owns** final composition and live migration application. P2-11 must not deploy or mutate the live target directly.
- **P2-12 owns** pre-migration backup and destructive restore rehearsal against the exact P2-11 migration ledger before any live application.
- **P2-13 owns** post-restart proof that account, character position, item, quest, progression and clan state survive, and that unauthorized player/admin access remains denied.
- **Gameplay owners (P2-04/05/06/07/08/09)** keep their business rules. P2-11 stores generic durable state/observations only; it does not redefine spawn, quest, combat, item, economy, clan or PvP rules.
- **Admin command success contract:** queue/database status is not sufficient. A privileged runtime command may become successful only after the authoritative runtime returns a positive apply proof (`status=ok`, not explicitly unforwarded, `applied=true` directly or in `data`). The proof is persisted in `oldko.admin_runtime_command_confirmations`.
- **Admin read-model contract:** world/NPC/mob/skill/economy rows in `oldko.runtime_content_observations` are projections of owner-service observations, not gameplay authority. Their source and observation time must be exposed so stale data can be marked stale.
- **Server status contract:** only explicit runtime heartbeat observations can produce `online`; missing/stale heartbeat resolves fail-closed to `offline`, and player count is omitted when freshness/authority is not proven.
- **Runtime config contract:** only non-secret dynamic values may be stored in PostgreSQL. Passwords/tokens/private keys/credentials/API keys stay in WS35-style secret references/environment. A DB config change is separate from a service apply receipt.
- **Mail contract:** `NullDelivery`/capture/dev delivery is not proof of real email. Production verification/reset is blocked until a configured provider returns an accepted delivery acknowledgement; secrets must never be committed or emitted.
- **Migration contract:** the only schema mutation stream is `database/migrations/` through the checksum ledger. Historical service-owned migration scripts may verify compatibility but must not mutate production independently.
