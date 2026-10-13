WS05

# Dependency snapshot

Captured during the 2026-10-14 WS05 control session.

| Dependency | Ref | SHA | Why WS05 needs it |
| --- | --- | --- | --- |
| central coordination | `main` | `6bf5ffa72585249ded580645bcbdb53359838953` | Inbox/control baseline read before recovery |
| WS04 character client | `ws04-character-client` | `fffbd9372b67c2aaef600f7e50595bec7e23fe88` | Real character-list/create/select client instrumentation and native GL capture |
| WS03 KO1298 session | `ws03-ko1298-session` | `3a087ab1d98969ef531ac6e3f682f4a463222f5e` | Authenticated character-selection/session boundary |
| WS14 world session | `ws14-world-session` | `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b` | 1298 selected-character -> Moradon packet contract |
| WS50 rehearsal | `ws50-integration-rehearsal` | `9112bb4e326d016f3ca8a2a56495e3421ffa76c5` | Identified WS05 as stale and WS03/WS14 live handoff as critical integration gap |
| browser-capable OpenKO | `luisfelipe18/old-school-openko feature/port-posix` | `97eb0ea20207afc0c360bfed6915113572711be3` | Real C++ client compiled to WASM/WebGL2 |
| genuine client assets | `ko4life-net/ko-assets 1298` | `705874881c8308e0a45a0c849e4b3881088d8138` | Genuine 1298 Data/Chr/Object/DTex/Zones/etc. |
| protocol evidence | `Open-KO/KnightOnline` | `7d6cf81093e142c928c2ac9510512b2b182178b5` | Canonical 1298 client/server packet and world-loader evidence |

## Recovery evidence

Before this control session, `ws05-moradon-world` pointed to
`18282d0e70de7ccb30244a9f09e2b3bff3040155`, the same baseline from which WS04
started. There were no WS05-owned implementation files.

The branch was recovered by a non-force fast-forward to the verified WS04 head
`fffbd9372b67c2aaef600f7e50595bec7e23fe88`. No history was rewritten.

Do not silently float these refs in a PASS run. The native workflow pins the
external OpenKO/assets SHAs and records the OldKOWeb workstream SHAs here so a
future integration run can be reproduced.
