WS50

Revalidate the latest staging candidate after canonical WS10 Moradon E2E PASS, the WS09 public-smoke null Content-Length fix, the WS12 public-browser gateway-preflight hardening, and the WS01 public-staging WebSocket compatibility bridge.

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
- WS12 retries public WSS readiness and avoids a false-negative launcher block only when both same-origin gateway health endpoints are healthy.
- WS01 wrapper bridges the canonical WS10 artifact's local browser WebSocket targets by port only: 15100 -> same-origin /auth and 15001 -> same-origin /game under HTTPS, before Emscripten websocket.js loads. No KO packet/protocol/gameplay logic is changed.

This file only requests the existing WS50 staging-candidate workflow to freeze current provider heads and rerun the disposable rehearsal. No gameplay/provider protocol code change is authorized.
