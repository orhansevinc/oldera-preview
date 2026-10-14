WS10

# Dependency Snapshot

SELF: ws10-qa-integration; current head not independently resolved in this session.
LAST_SYNC: 2026-10-14; main control and provider branch documentation.
UPSTREAM:
- WS02 ws02-websocket-gateway: transport implemented, STATUS read; exact HEAD not verified.
- WS03 ws03-ko1298-session: implementation commit 6dfb73e61d14676559d786baf332632cfd15de9d; 10/10 local tests reported; create/list/select and WS14 handoff.
- WS04 ws04-character-client: provider evidence commit fffbd9372b67c2aaef600f7e50595bec7e23fe88; browser driver and character instrumentation.
- WS05 ws05-moradon-world: native render gate implemented; live integrated PASS not demonstrated; exact HEAD not verified.
- WS14 ws14-world-session: implementation 0f12a49eb72cb5e8f776193c0cce7feb7866e1cf, closing evidence 8f013cbeab397e03dcd1a816d7d8b93c511d3ad2; reported 14/14 tests PASS.
CONTRACTS: WS03 WIZ_NEW_CHAR 0x02 / WIZ_SEL_CHAR 0x04 -> WS14 beginSelectedCharacter; 0D 01/02 GAMESTART; WS05 zone21 terrain/shape/local player/native GL gate.
DOWNSTREAM: Ana Kontrol Hattı Moradon readiness decision.
BLOCKERS: WS10 isolated live browser integrated compose/evidence missing; production world repository adapter separate prerequisite.
