WS03

# Dependency snapshot — production gameplay-session hardening

Read/verified on 2026-10-14 before this implementation.

## Control / proof pins

- `main@c75118905217343d30d3e25cf24a1552a5dc82b1` — current central control branch observed while starting this task.
- `ws10-qa-integration@4a81c6cf7e11514ca01f0730ecc57010c9ea37fb` — canonical Moradon E2E PASS documentation.
  - canonical WS10 run: `#26`, run id `38505039290`, PASS.
- `ws50-integration-rehearsal@9e0fc1822351965755fc490c2d2abf34d40f430d` — READY staging handoff with the previous WS03 fixture fix.
- latest observed public staging proof: WS09 ephemeral run `#6`, run id `38515548307`, PASS at commit `22254254776293d0f3eed45950011de8742532fc`.
  - It proved public HTTPS + WSS `/auth` + `/game` and WS12 preflight.
  - The ephemeral tunnel was intentionally torn down after its hold window; it is evidence, not a currently live URL.
  - That run froze pre-hardening WS03 `237c4a613e94434baae656c1399cb449e7b78067`; this new WS03 head still needs promotion through WS50/WS09 for a fresh public proof.

## Direct gameplay contract pins

- WS14 world-session: `82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b`
- WS15 movement: `ba44d65628a78f475b376a3996ff32b21ff1e1ab`
- WS16 NPC: `e6ee973eead1dbd40f5e7a5e2eb7bc5bd29235a2`
- WS17 item/inventory: `f557e91c79413960712aa621b0a034796d899c48`
- WS19 combat: `8a74d9e5b0f78deea4ad45fc991d145bbb70fe03`
- WS22 merchant/economy: `0503d10f55df15a50d33b5d856516aead260a3e2`
- WS25 mob AI: `ff1804a7d7a1328727924c50be39792d2caa2483`
- WS26 drop/loot: `24290da1c9cc2a0f0d40bf2e017cef2dcc8e0866`
- WS27 progression: `9cd78a5c9eacee0cfa737e6123ba84f55e39ab27`
- WS45 session ownership: `4a66338743553c2781c68ca84b866ff4e999c14e`

## Contract conclusions

1. WS14 remains the authoritative character-select/world lifecycle provider and owns the canonical Moradon `GAMESTART` path.
2. WS15 gives exact verified `0x06`/`0x09` inbound payload contracts plus `registerSession`, `teleport`, and `disconnect` lifecycle APIs.
3. WS16 gives exact verified `0x1D`/`0x20`/`0x22` packet contracts, but `0x1D` conflicts with WS14's current bootstrap ownership.
4. WS17/WS19/WS22 expose domain boundaries but the consumed contracts do not provide a verified inbound 1298 opcode mapping for WS03. They remain unbound by design.
5. WS25/WS26/WS27 return domain events/state. Client serialization remains an explicit outbound encoder responsibility.
6. WS45 requires **string** `sessionId`, account claim after credential validation, character claim before world spawn, and idempotent disconnect/release. WS03 now uses `game:<socketId>` as the stable session lease id while retaining the uint16 `socketId` required by WS14/wire identity.
7. Current WS14 `WorldSessionService` has no public disconnect/cleanup method. WS03 has the deterministic cleanup port ready, but WS14 session-map release cannot be performed through a verified public contract yet.
