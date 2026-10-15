# OldKOWeb local-first development handoff

This directory is the self-contained continuation point for P2-00. The product code baseline is `99c6571be82644436b83b7ccca299d384126f0ee`. The handoff snapshot is a separate commit whose direct parent must be that code SHA.

## Status

**Development handed off:** yes. **Ready for release:** no.

GitHub Actions run `38804986660` built the genuine integrated C++/WASM client, ran merged provider contract tests, and built runtime/edge images successfully. It then failed at step 15, `Local one-stack PostgreSQL/runtime/edge smoke`. Candidate generation, the Windows PowerShell 5.1 package/token check, and publish were skipped. No workflow artifact was persisted. Do not convert this failure into a PASS and do not deploy this candidate.

Job log: `https://github.com/orhansevinc/oldera-preview/actions/runs/38804986660/job/116663394632`

## Local working rule

Open and change only `C:\Users\Orhan\OldKOWeb-Dev`. Treat `C:\Users\Orhan\OldKOWeb` as the existing live/runtime source and an optional read-only Git-object/source cache. Do not copy its `.env`, Docker volumes, tunnel files, secret files or generated credentials into the development tree. Do not run production migrations or `hosting/p2-00/Apply-Release.ps1` while fixing the local gate.

GitHub is no longer the edit/test loop. Commit locally as useful; push a source backup in one batch only when Orhan asks for it.

## Fixed external inputs

- OpenKO: `luisfelipe18/old-school-openko@97eb0ea20207afc0c360bfed6915113572711be3`
- KO assets: `ko4life-net/ko-assets@2055ee6ed77f1b5cfef23832dd5bc31909e14a66`
- WS05 patch authority: `0537c481383a69c534799b43810f35e7279c5578`
- WS10 visibility patch authority: `163f2ebf81e750bf746fdaa277695329a0682e22`
- Emscripten: `3.1.50`
- Moradon SMD: `Open-KO/KnightOnline@7d6cf81093e142c928c2ac9510512b2b182178b5`, blob `cf47772b8e42a8bad71032419f47978c8bbd6142`, 786000 bytes.
- Canonical client builder: `tools/p2-00/build-client.sh`.
- Local workflow-parity gate: `tools/p2-00/local-release-gate.sh`. It is pinned to the current `.github/workflows/p2-00-final-release.yml` blob `51b7e83c8761f37362d41b85c61377e2afd9fb95` so drift fails closed.

The repository has no `.gitmodules` and no `.gitattributes` Git-LFS declaration at this baseline. OpenKO and KO assets are external source inputs; a CI checkout folder, pointer, old C5 bundle or temporary artifact is not an authoritative full source replacement.

## Migration order

The forward order is fixed:

1. `database/migrations/0001_init.sql`
2. `database/migrations/0002_persistence_hardening.sql`
3. `database/migrations/0003_public_account_api.sql`
4. `database/migrations/0004_admin_persistence.sql`
5. `database/migrations/0005_phase2_data_admin.sql`

The canonical runner is `node services/oldko-data/src/scripts/migrate.js`, followed where required by `node services/account-api/src/scripts/apply-rate-limit-schema.js`. In development, these commands are used only against the isolated local-gate PostgreSQL project, never the live database.

## One-time WSL build dependencies

From PowerShell, after the transfer finishes:

```powershell
wsl.exe bash -lc "sudo apt-get update && sudo apt-get install -y ninja-build cmake python3 git zip jq curl"
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && if [ ! -d .toolchains/emsdk/.git ]; then mkdir -p .toolchains && git clone https://github.com/emscripten-core/emsdk.git .toolchains/emsdk; fi && cd .toolchains/emsdk && ./emsdk install 3.1.50 && ./emsdk activate 3.1.50"
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && mkdir -p .local-deps && cd .local-deps && test -f package.json || npm init -y >/dev/null && npm install --no-save --no-audit --no-fund playwright@1.55.0 && npx playwright install chromium"
```

Do not install an arbitrary newer Emscripten or Playwright version for the reproduction.

## Build and tests

Load the exact Emscripten environment for every shell:

```powershell
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && source .toolchains/emsdk/emsdk_env.sh >/dev/null && bash tools/p2-00/local-release-gate.sh build"
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && source .toolchains/emsdk/emsdk_env.sh >/dev/null && bash tools/p2-00/local-release-gate.sh contracts"
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && source .toolchains/emsdk/emsdk_env.sh >/dev/null && bash tools/p2-00/local-release-gate.sh images"
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && source .toolchains/emsdk/emsdk_env.sh >/dev/null && bash tools/p2-00/local-release-gate.sh smoke"
```

`smoke` is the first outstanding real failure to reproduce. It uses a dedicated Compose project and port 18088; it does not read the live `.env` and it does not invoke production deployment. Its cleanup intentionally does not remove Docker volumes.

For a full local rerun after the first failure is understood:

```powershell
wsl.exe bash -lc "cd /mnt/c/Users/Orhan/OldKOWeb-Dev && source .toolchains/emsdk/emsdk_env.sh >/dev/null && bash tools/p2-00/local-release-gate.sh all"
```

## Existing mechanisms that remain authoritative

`hosting/p2-12` remains the Windows host/readiness/update/diagnostic implementation. `hosting/p2-00/Apply-Release.ps1` remains the release apply entrypoint and is deliberately **not** called by the development gate. `qa/phase2` remains the acceptance/browser/release-gate implementation. The local gate reuses those QA files, the real domain-live Compose/Dockerfiles, and the existing P2-00 client builder rather than creating a second game implementation.

## Client reuse rule

Do not copy `real1298` from the live folder just because it exists. Reuse a client only when its runtime manifest and JS/WASM/DATA SHA-256 values prove the same integration source and the same OpenKO/assets/WS05/WS10/Emscripten inputs. Run `38804986660` did not upload its successful build output, so the safe initial local path is a rebuild. Never label the older C5 binary as output of this baseline.

## First work item

Reproduce `Local one-stack PostgreSQL/runtime/edge smoke` locally and capture the first failing command plus `artifacts/phase2-qa/compose.log`/browser evidence. Until that gate passes, Windows package verification and publish remain blocked.
