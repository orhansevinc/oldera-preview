WS50

Revalidate the latest staging candidate after canonical WS10 Moradon E2E PASS and the WS09 public-smoke null Content-Length fix.

Canonical WS10 PASS:
- run id: 38505039290
- run number: 26
- head: f0cadfb50b5d1a36d2bfe4e5bf0a68f7c3061f41
- PASS evidence artifact: ws10-moradon-e2e-26
- passing client artifact: ws10-moradon-passing-client-26

WS09 publisher follow-up to freeze:
- ws09-production-infra includes commit df0651f79338798f17b949b9bd42c2d634aa2e6e
- change is limited to public smoke handling when an intermediary omits Content-Length on HEAD; exact body size/hash remains enforced by the following WS12 publication preflight.

This file only requests the existing WS50 staging-candidate workflow to freeze current provider heads and rerun the disposable rehearsal. No provider/game/client code change is authorized.
