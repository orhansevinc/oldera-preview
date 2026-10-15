# OldKOWeb local-first instructions

The authoritative continuation point for this repository is `coordination/local-first/README-LOCAL.md` and `coordination/local-first/HANDOFF.json`.

- Work from `C:\Users\Orhan\OldKOWeb-Dev`, not the existing live/runtime folder `C:\Users\Orhan\OldKOWeb`.
- The inherited product-code baseline is `99c6571be82644436b83b7ccca299d384126f0ee`. The local-first handoff commit is documentation/tooling on top of that baseline; do not roll product code back to an older SHA.
- P2-01 through P2-13 are already merged. Do not recreate or re-merge those workstreams unless a concrete local fix requires changing their integrated code.
- Preserve the approved website/account design, admin v10, real OpenKO C++/WASM client, and accepted mouse/camera behavior.
- Current state is development-handoff-ready but release-not-ready. Run `38804986660` failed at `Local one-stack PostgreSQL/runtime/edge smoke`; Windows package verification and publish were skipped.
- Never treat a skipped or failed gate as PASS. Fix and test locally first.
- Do not copy, print or commit live `.env` files, secrets, tunnel credentials, DB contents or Docker volumes. Do not change the live Compose project, ports or production database during ordinary development.
- Do not run production migrations or `hosting/p2-00/Apply-Release.ps1` unless Orhan explicitly switches from development to an approved release operation.
- Use the exact OpenKO, KO-assets, WS05, WS10 and Emscripten pins in `HANDOFF.json`. Do not substitute an old C5 binary for a new build.
- Use `tools/p2-00/local-release-gate.sh` plus the existing `tools/p2-00/build-client.sh`, `qa/phase2`, `hosting/p2-12`, `hosting/p2-00` and domain-live Compose/Dockerfiles; do not create an HTML game substitute or a second parallel runtime implementation.
- GitHub is backup, not the inner development loop. Develop/build/test locally; batch-push source backup when Orhan asks for it.
- `DEVELOPMENT.md` contains an older historical checkpoint. For Phase 2 continuation, this file and `coordination/local-first/*` take precedence where they differ.
