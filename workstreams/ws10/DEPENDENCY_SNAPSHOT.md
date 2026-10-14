WS10

# DEPENDENCY SNAPSHOT — Moradon E2E run 16

The WS10 integration workflow froze these provider refs before execution. Every provider branch was consumed read-only in isolated worktrees; WS10 did not merge or push to any provider branch.

| Provider | Branch / source | Exact SHA | Run 16 use / evidence |
|---|---|---|---|
| WS02 | `ws02-websocket-gateway` | `1738f60945b24e00bdd2266e6600b5c0cf3c64cf` | Real browser WebSocket -> TCP auth/game transport; provider suite **7/7 PASS**. |
| WS03 | `ws03-ko1298-session` | `d634870bbcd2c541695516643d34e0ac119354d7` | Real auth/session/create/list/select provider; provider suite **10/10 PASS**; live `0x02` create and `0x04` select observed. |
| WS04 | `ws04-character-client` | `fffbd9372b67c2aaef600f7e50595bec7e23fe88` | Genuine WASM Character Select/Create instrumentation and native frame-capture hook; WS05 ancestry check passed. |
| WS05 | `ws05-moradon-world` | `d55acd52a39451a190127282ff66f6ec0f6d0f94` | Genuine world asset preload + native Moradon render probes/gate. Instrumentation applied successfully; runtime gate is the blocking provider contract. |
| WS11 | `ws11-protocol-lab` | `05562662d9d3f13a4b0500d0478e065fd802cfd0` | Frozen read-only protocol evidence dependency. |
| WS14 | `ws14-world-session` | `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` | Real `WorldSessionService`; provider suite **14/14 PASS**; live GAMESTART/MYINFO/ZONEABILITY/region/NPC bootstrap observed. |
| WS45 | `ws45-session-ownership` | `4a66338743553c2781c68ca84b866ff4e999c14e` | Frozen read-only session-ownership dependency. Production lease readiness is separate from this deterministic single-instance E2E. |

## External pinned inputs

| Input | Exact identity | Evidence |
|---|---|---|
| OpenKO browser-capable source | `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3` | Real C++ client built to Emscripten/WASM/WebGL2 in run 16. |
| KO 1298 assets | `ko4life-net/ko-assets@2055ee6ed77f1b5cfef23832dd5bc31909e14a66` | Commit verified in CI. |
| KO 1298 asset tree | `705874881c8308e0a45a0c849e4b3881088d8138` | Tree identity verified in CI; genuine world roots and Moradon files required before build. |

## WS10 integration identity

- Branch: `ws10-qa-integration`
- Tested harness commit: `3c22e0e6907b74651589a18818bbcc7e930698b2`
- Workflow: `WS10 Moradon E2E Integration Gate`
- Canonical evidence run: **#16**, run id `38490102763`
- Artifact: `ws10-moradon-e2e-16`, artifact id `11862255468`
- Artifact digest: `sha256:fa17440411049f8f8fc9395934a9c3b7c27bd0b4be7995d310fe2966bec665bb`

## Composition boundary

The deterministic account/character/world repository lives only under WS10-owned QA code. It backs the real WS03 `AuthSession`/`GameSession` and real WS14 `WorldSessionService`; it does not manufacture protocol/world PASS packets. This is explicitly permitted by the WS10 inbox so production persistence is not a prerequisite for the Moradon E2E proof.

Production DB/session-lease readiness is therefore not the current Moradon blocker. The first unresolved gate is WS05's native-zone interpretation after the real client transitions from server/wire zone `21` to client-native zone `210`.
