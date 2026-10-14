WS05

# Dependency snapshot — 2026-10-14 control rerun

## SELF

- Workstream: `WS05`
- Branch: `ws05-moradon-world`
- Pre-fix head: `d55acd52a39451a190127282ff66f6ec0f6d0f94`
- Zone-reconciliation implementation: `c72346b84c19db43452e0b1739bd53d2bff4c804`
- Static validation: `WS05 Moradon World` run #2 / `38492131244` / `ws05-contract-gate=SUCCESS`

## CENTRAL CONTROL

- `main` checked at `8e449f9b76a2f973047f7a89f2e37c8d17c04241`.
- Consumed: `coordination/MASTER_CONTROL.md`, `BROADCAST.md`, `WORKSTREAM_REGISTRY.md`, `TASK_QUEUE.md`, `MORADON_CRITICAL_PATH.md`, and `coordination/inbox/WS05.md`.
- Inbox priority: Moradon final native-render blocker; reconcile authentic wire zone `21` with pinned 1.298 native zone `210` without changing WS03/WS14 semantics.

## UPSTREAM / EVIDENCE

| Dependency | Ref / evidence | State consumed by WS05 |
| --- | --- | --- |
| WS10 QA/E2E | `ws10-qa-integration@34c551518aad87a9fd03d392f193d354483c95a0`; run #16 `38490102763`; tested harness `3c22e0e6907b74651589a18818bbcc7e930698b2` | Real browser path reaches native main scene. Wire zone 21 becomes native zone 210; `Zones\\Moradon_xmas.gtd` is loaded. First blocker was WS05's native comparison to 21. |
| WS03 session | `ws03-ko1298-session@d634870bbcd2c541695516643d34e0ac119354d7` | Character create/select and WS14 handoff are complete; WS05 must not change this protocol ownership. |
| WS14 world | `ws14-world-session@82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` | Source-verified Moradon server/wire zone remains 21; GAMESTART/MYINFO/world bootstrap ownership stays server-side. |
| WS04 client baseline | inherited through WS05 ancestry from `fffbd9372b67c2aaef600f7e50595bec7e23fe88` | Real character UI/probes and native pre-swap GL capture used by the render gate. |
| OpenKO browser client | `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3` | Pinned C++ client behavior converts selected-character zone to native 210 for this format generation. |
| KO 1298 assets | pinned provider used by WS05/WS10 | Genuine world assets only; no generated replacement geometry or browser background accepted. |

## CONTRACTS

- Network/server Moradon identity: `zone=21`.
- Native browser-client world identity after authentic 1.298 conversion: `native_zone=210`.
- WS05 evidence markers intentionally contain both identities: `zone=21 native_zone=210`.
- PASS still requires authentic terrain render + shape render + local-player render + non-black native GL framebuffer in one real C++/WASM browser session.
- Fatal Null/WebGL/GL evidence remains rejecting.

## DOWNSTREAM

- WS10 is the immediate consumer. Its current browser driver waits for `WS05_GATE ... zone=21` by substring, so the appended `native_zone=210` is backward-compatible with an unchanged rerun.
- Ana Kontrol Hattı remains the authority for merge/integration decisions.

## BLOCKERS

- No known WS05 code blocker remains after `c72346b84c19db43452e0b1739bd53d2bff4c804`.
- Full native Moradon PASS remains **unverified after the fix** until the integrated WS10 E2E is rerun; this is a validation step, not permission to fake evidence or alter server zone semantics.

## LAST_SYNC

Evidence above was checked during the 2026-10-14 WS05 control session immediately before closure documentation.
