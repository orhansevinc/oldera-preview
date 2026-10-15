#!/usr/bin/env bash
set -euo pipefail

: "${OPENKO_SHA:=97eb0ea20207afc0c360bfed6915113572711be3}"
: "${KO_ASSETS_SHA:=2055ee6ed77f1b5cfef23832dd5bc31909e14a66}"
: "${WS05_ROOT:=.providers/ws05}"
: "${WS10_ROOT:=}"

[[ "$(git -C openko rev-parse HEAD)" == "$OPENKO_SHA" ]]
[[ "$(git -C ko-assets rev-parse HEAD)" == "$KO_ASSETS_SHA" ]]

python3 "$WS05_ROOT/tools/patch_openko_browser.py"
python3 "$WS05_ROOT/tools/patch_openko_browser_gateway.py"
python3 "$WS05_ROOT/tools/fix_browser_server_ini_case.py"
python3 "$WS05_ROOT/tools/patch_openko_browser_serverlist_probe.py"
python3 "$WS05_ROOT/tools/patch_openko_browser_auth_probe.py"
python3 "$WS05_ROOT/tools/ws04_character/patch_character_client.py"
python3 "$WS05_ROOT/tools/ws04_character/patch_frame_capture.py"
python3 "$WS05_ROOT/tools/ws05_moradon/patch_moradon_client.py"
if [[ -n "$WS10_ROOT" ]]; then
  python3 "$WS10_ROOT/qa/moradon/patch_visibility_observability.py"
fi
python3 tools/p2_03_patch_openko_render.py openko
python3 client-src/p2_10/apply_browser_input_lifecycle.py openko
python3 client-src/p2_00/enable_browser_audio_pthreads.py openko

# The accepted WS05 browser patch predates the exact P2-10 toolchain and adds
# GL_ENABLE_GET_PROC_ADDRESS. Emscripten 3.1.50 removed that setting. OpenKO's
# Emscripten GLLoader already binds GLES3 symbols directly, so this legacy
# proc-address compatibility switch is both unnecessary and invalid here.
python3 - <<'PY'
from pathlib import Path
p=Path('openko/src/Client/WarFare/CMakeLists.txt')
s=p.read_text(encoding='utf-8')
legacy='    "-sGL_ENABLE_GET_PROC_ADDRESS=1"\n'
if s.count(legacy) != 1:
    raise SystemExit(f'expected exactly one legacy GL_ENABLE_GET_PROC_ADDRESS flag, got {s.count(legacy)}')
p.write_text(s.replace(legacy,'',1),encoding='utf-8')
print('PASS: removed obsolete GL_ENABLE_GET_PROC_ADDRESS for emsdk 3.1.50')
PY

# The accepted C5 build required this exact escaped-GLSL normalization after
# the canonical WS05 browser patch. Keep it source deterministic.
python3 - <<'PY'
from pathlib import Path
p=Path('openko/src/Client/WarFare/RHIDeviceGL.cpp')
s=p.read_text(encoding='utf-8')
bad=r'#version 300 es\nprecision highp float;'
good='#version 300 es\nprecision highp float;'
if bad in s:
    if s.count(bad)!=2: raise SystemExit(f'expected exactly 2 escaped GLSL anchors, got {s.count(bad)}')
    p.write_text(s.replace(bad,good),encoding='utf-8')
elif s.count(good)<2:
    raise SystemExit('GLSL ES 300 anchors are missing')
PY

python3 client-src/p2_10/verify_browser_source.py openko

grep -q 'P2-03 browser render surface' openko/src/Client/WarFare/WarFareMainSDL.cpp
grep -q 'P2-10 browser input lifecycle' openko/src/Client/WarFare/WarFareMainSDL.cpp
grep -q 'P2-00 pthread browser audio' openko/src/N3Base/N3SndMgr.cpp
if [[ -n "$WS10_ROOT" ]]; then grep -q 'WS10_VISIBILITY RENDERED' openko/src/Client/WarFare/PlayerBase.cpp; fi
if grep -q 'browser audio unavailable: native audio workers require pthreads' openko/src/N3Base/N3SndMgr.cpp; then
  echo 'single-thread browser audio guard survived P2-00 patch' >&2
  exit 1
fi

emcc --version | tee artifacts/phase2-qa/emscripten-version.txt
emcmake cmake -S openko -B build-web -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS='-pthread -DBOOST_HAS_PTHREADS=1' \
  -DCMAKE_CXX_FLAGS='-pthread -DBOOST_HAS_PTHREADS=1 -DASIO_DISABLE_THREADS=1 -fexceptions' \
  -DCMAKE_EXE_LINKER_FLAGS='-pthread -fexceptions -sPTHREAD_POOL_SIZE=4' \
  -DOPENKO_BUILD_CLIENT=ON \
  -DOPENKO_CLIENT_POSIX_EXPERIMENTAL=ON \
  -DOPENKO_BUILD_CLIENT_TOOLS=OFF \
  -DOPENKO_BUILD_TOOLS=OFF \
  -DOPENKO_BUILD_SERVERS=OFF \
  -DOPENKO_BUILD_TESTS=OFF \
  -DOPENKO_FETCH_CLIENT_ASSETS=OFF \
  -DOPENKO_COMPILE_WARNINGS_AS_ERROR=OFF \
  2>&1 | tee artifacts/phase2-qa/client-configure.log
cmake --build build-web --target WarFare -j2 2>&1 | tee artifacts/phase2-qa/client-build.log

OUT=build-web/bin/Release
for f in KnightOnLine.js KnightOnLine.wasm KnightOnLine.data; do [[ -s "$OUT/$f" ]] || { echo "missing $OUT/$f" >&2; exit 1; }; done
mkdir -p real1298
rm -f real1298/KnightOnLine.js real1298/KnightOnLine.wasm real1298/KnightOnLine.data real1298/KnightOnLine.worker.js real1298/runtime-manifest.json
cp "$OUT/KnightOnLine.js" "$OUT/KnightOnLine.wasm" "$OUT/KnightOnLine.data" real1298/
if [[ -s "$OUT/KnightOnLine.worker.js" ]]; then cp "$OUT/KnightOnLine.worker.js" real1298/; fi
cp deploy/domain-live/play-production-index.html real1298/index.html
sha256sum real1298/KnightOnLine.js real1298/KnightOnLine.wasm real1298/KnightOnLine.data | tee artifacts/phase2-qa/client-sha256.txt
stat -c '%n %s' real1298/KnightOnLine.js real1298/KnightOnLine.wasm real1298/KnightOnLine.data | tee artifacts/phase2-qa/client-sizes.txt
