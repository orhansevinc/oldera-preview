# WS50 — C4 Moradon visibility child candidate

## Decision

`WS50-C3` stays immutable. The next canonical child is `WS50-C4`.

- Parent: `WS50-C3@sha256:a9c808898bd1cb9f3cadfb44ddbabadaf34448f9aef0a4990ca91958053458aa`
- Child: `WS50-C4@sha256:9ab09b5c0e819b6379a3a9152f1e7eafd50df9eeeb3db8946638fd95008f3049`
- Candidate result: **BLOCKED**
- Last accepted browser set: `WS50-B0`

This is not a latest-HEAD composition. Only WS11/WS14/WS16/WS25 were resolved once at task start; every other provider remains exactly C3-pinned.

## Exact delta from C3

| Provider | C3 | C4 |
|---|---|---|
| WS11 | `9ad710e54eda464217ff6cef74ae4a9cf196d68f` | `944b6ff9b6329af29f1048a74aa6e14fca141639` |
| WS14 | `c1a1d454285db02c6de0c087a2d65434bfb4593b` | `9b82adefb05a3cca32f430e25f8a1d9109db93b2` |
| WS16 | `234657c1264ead6b8828425ae9e7fcdca0cca5c8` | `5ed48ff32187000312652838674388df52fc3fb7` |
| WS25 | `a42b489e1a17d7c2889cfd92909ddd45c65e825e` | `a334f54f9a6bd3ac416bd099cc48060f88a7e7fd` |

Unchanged authority/runtime pins include WS03 `495de481...`, WS15 `ce9bed13...`, WS31 `546d2ab6...`, browser baseline `18282d0e...`, and the B0 client/runtime artifact identity.

## What C4 closes

### WORLD_TERRAIN_HEIGHT_AUTHORITY — CLOSED

The CI downloads the exact pinned OpenKO `moradon_0826.smd`, verifies Git blob `cf47772b8e42a8bad71032419f47978c8bbd6142` and byte length `786000`, then runs the detached C4 worktree with real provider tests. The C4 receipt must show real WS14 -> WS16 NPC height materialization and real WS14 -> WS25 135-slot mob height materialization.

### NPC_REGION_BODY_AUTHORITY — CLOSED

WS11 `944b6ff...` verifies the exact visibility family:

- `0x1C WIZ_NPC_REGION` — runtime ID list;
- `0x1D WIZ_REQ_NPCIN` — missing-ID request + exact detail response;
- `0x0A WIZ_NPC_INOUT` — incremental IN/OUT for NPC and monsters.

C4 runs WS11's visibility validator over the exact golden binary fixtures. Packet parity is therefore protocol-ready even though the full composed flow cannot reach packet emission.

## Exact first blocker

### MOB_RUNTIME_NETWORK_IDENTITY_AUTHORITY

C4 intentionally reproduces this as the first composition blocker.

Pinned WS14's `mobIdentity()` rejects a nearby mob unless `instanceId`, `nid`, or `id` is an integer. Pinned WS25 `a334f54...` still builds the mob `id` from `groupId/spawnId` and `snapshotMob()` carries no integer `runtimeId` or `instanceId`.

That is a provider contract gap, not something WS50 owns. Creating a synthetic integer in WS50 would violate the no-mock/no-guess rule and would make the provider-set lie about ownership.

Therefore the requested exact flow is recorded as:

1. auth/world regression — PASS;
2. GAMESTART loading — **BLOCKED at mob identity normalization**;
3. real NPC and mob materialization — PASS as provider preflight evidence;
4. combined `0x1C`, simulated `0x1D`, exact NPC/mob details, `0x0A` IN/OUT, WORLD_READY and disconnect cleanup — **NOT RUN AFTER FIRST BLOCKER**.

## Readiness

| Gate | C4 |
|---|---|
| DOMAIN_READY | READY |
| CONTRACT_READY | BLOCKED |
| PROTOCOL_READY | READY |
| COMPOSITION_READY | BLOCKED |
| BROWSER_READY | BLOCKED |
| WS49 READY | NO |
| WS10 READY | NO |

A later candidate may use `BROWSER_READY = NEEDS_WS10` only after contract + composition are green.

## CI meaning

GREEN CI for C4 means:

- C3 was not mutated;
- C4 hash/lineage/exact provider closure are valid;
- exact SMD identity is valid;
- exact provider tests reproduce authoritative materialization;
- exact WS11 visibility fixtures validate;
- the expected first blocker is reproduced;
- WS50 did not invent a mob runtime ID;
- browser readiness remains false.

GREEN does **not** mean C4 is browser-ready.
