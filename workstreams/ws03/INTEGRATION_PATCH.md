# WS03 integration patch requirements

No shared file was modified.

1. WS02 must route raw framed TCP bytes unchanged to WS03 AUTH `15100` and GAME `15001` (or configured ports).
2. Browser `Server.ini` / runtime endpoint mapping must point login traffic to the WS02 route backed by WS03; WS03 does not change client files.
3. Confirm the production browser build's `_CRYPTION` define. If enabled, add the exact JV crypto handshake to WS03 before real-client game-login testing.
4. Character/world handoff requires the verified successful `WIZ_ALLCHAR_INFO_REQ`, `WIZ_NEW_CHAR`, `WIZ_SEL_CHAR` response records and then WS14's world-session contract. No guessed placeholder packets should be added.
