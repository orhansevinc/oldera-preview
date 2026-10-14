WS50

Revalidate the latest staging candidate after canonical WS10 Moradon E2E PASS, the WS09 public-smoke null Content-Length fix, the WS12 public-browser gateway-preflight hardening, the WS01 public-staging WebSocket compatibility bridge, and the WS03 development/staging world-snapshot completion fix.

STAGING_CANDIDATE_TRIGGER=WS03_WORLD_SNAPSHOT_FIX

Canonical WS10 PASS:
- run id: 38505039290
- run number: 26
- head: f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
- PASS evidence artifact: ws10-moradon-e2e-26
- passing client artifact: ws10-moradon-passing-client-26

Publication/provider follow-up to freeze:
- ws09-production-infra includes commit df0651f79338798f17b949b9bd42c2d634aa2e6e
- ws12-browser-launcher includes commit 121bb7bdb82c364bf9459111096f5ff007873a61
- ws01-runtime-build includes commit 57d0aa7c6a82810d5f126bda83a368e7eb7801bb
- ws03-ko1298-session includes commit 237c4a613e94434baae656c1399cb449e7b78067
- WS12 retries public WSS readiness and avoids a false-negative launcher block only when both same-origin gateway health endpoints are healthy.
- WS01 wrapper bridges the canonical WS10 artifact's local browser WebSocket targets by port only: 15100 -> same-origin /auth and 15001 -> same-origin /game under HTTPS, before Emscripten websocket.js loads. No KO packet/protocol/gameplay logic is changed.
- WS03 now supplies the protocol-complete 1298 world character snapshot that WS14 MYINFO requires in the in-memory staging repository. This closes the public-only disconnect where character select succeeded and Moradon rendered locally, but the first GAMESTART/MYINFO composition threw because development fixture fields such as rank/maxHp/authority were absent.

This file only requests the existing WS50 staging-candidate workflow to freeze current provider heads and rerun the disposable rehearsal. No unrelated gameplay/provider changes are authorized.
