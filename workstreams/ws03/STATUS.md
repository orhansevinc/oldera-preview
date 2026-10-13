# WS03 STATUS

1. **En ileri ulaşan gerçek client state:** Source-verified packet path reaches GAME login/nation-select. This branch has byte-level replay tests, but has **not** been wired through WS02 to a live WASM client, so real-browser character-select/world entry is not claimed.
2. **Implement edilen packetler:** AUTH server list/login/news; GAME version=1298, game login, nation selection; exact AA55 framing/fragment reassembly; development repository fixture `osevinc/osevinc`.
3. **Eksikler:** JV cryption decision/implementation if `_CRYPTION` is enabled in WASM; successful character-list record; create/select responses; post-select MYINFO/GAMESTART/world bootstrap.
4. **Branch:** `ws03-ko1298-session`
5. **Commit:** see branch HEAD after commit.
6. **Test komutları:** `cd services/ko1298-session && npm test`; run server with `node server.js`.
7. **Integration gereksinimleri:** WS02 raw transport routing; confirm WASM `_CRYPTION`; coordinate successful char-select/world boundary with WS14. See `INTEGRATION_PATCH.md`.
