#!/usr/bin/env python3
from pathlib import Path
import shutil
import subprocess


# The browser build starts from a deliberately small 1298 sparse checkout.
# Character Select needs its original room/lighting/texture slice, so expand
# the same genuine 1298 asset checkout rather than recreating anything in JS.
assets = Path("ko-assets")
subprocess.run(
    ["git", "-C", str(assets), "sparse-checkout", "add", "ChrSelect"],
    check=True,
)

required_chrselect = [
    assets / "ChrSelect" / "el_chairs.n3shape",
    assets / "ChrSelect" / "el_light_0.n3light",
    assets / "ChrSelect" / "el_light_1.n3light",
    assets / "ChrSelect" / "el_light_2.n3light",
    assets / "ChrSelect" / "ka_chairs.n3shape",
]
missing = [str(p) for p in required_chrselect if not p.is_file()]
if missing:
    raise SystemExit("ChrSelect sparse checkout missing required 1298 assets: " + ", ".join(missing))

# OpenKO's POSIX DFont scans /data/Fonts for a usable TTF. Keep the font a
# runtime implementation detail inside KnightOnLine.data; it is never exposed
# as a standalone downloadable project artifact.
font_candidates = [
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
]
font_source = next((p for p in font_candidates if p.is_file()), None)
if font_source is None:
    font_source = next(Path("/usr/share/fonts").rglob("*.ttf"), None)
if font_source is None:
    raise SystemExit("No runtime TTF found on the GitHub runner")

fonts = assets / "Fonts"
fonts.mkdir(parents=True, exist_ok=True)
shutil.copyfile(font_source, fonts / "BrowserUI.ttf")
print(f"Browser runtime font staged from {font_source.name}")

cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = cmake.read_text()

# N3 files were authored on a case-insensitive Windows filesystem. Their
# embedded references are lower-case (chrselect\\...), while the repository
# folder is ChrSelect. The POSIX resolver normally bridges this, but Emscripten
# virtual FS directory iteration is not reliable enough for this hot path.
# Mount the exact same genuine assets at both spellings for browser builds.
ui_preload = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/UI_US@/data/UI_US"\n'
extra_preloads = (
    ui_preload
    + '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/ChrSelect"\n'
    + '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/chrselect"\n'
    + '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Fonts@/data/Fonts"\n'
)
if "ko-assets/ChrSelect@/data/chrselect" not in s:
    if ui_preload not in s:
        raise SystemExit("UI_US preload anchor not found")
    s = s.replace(ui_preload, extra_preloads, 1)

old = "${CMAKE_SOURCE_DIR}/../ko-assets/Server.ini@/data/Server.ini"
new = "${CMAKE_SOURCE_DIR}/../ko-assets/Server.ini@/data/Server.Ini"
if new not in s:
    if old not in s:
        raise SystemExit("Server.ini preload anchor not found")
    s = s.replace(old, new, 1)
cmake.write_text(s)

# Browser-only diagnostics for silent N3 file-open failures. This gives us the
# requested and resolved path without changing desktop behavior.
file_reader = Path("openko/src/FileIO/FileReader.cpp")
s = file_reader.read_text(encoding="utf-8-sig")
old_catch = '''\tcatch (const boost_ipc::interprocess_exception&)
\t{
\t\treturn false;
\t}
'''
new_catch = '''\tcatch (const boost_ipc::interprocess_exception&)
\t{
#ifdef __EMSCRIPTEN__
\t\tstd::fprintf(stderr, "[asset-open-fail] requested='%s' resolved='%s'\\n", path.string().c_str(), openPath.string().c_str());
#endif
\t\treturn false;
\t}
'''
if "[asset-open-fail]" not in s:
    if old_catch not in s:
        raise SystemExit("FileReader open-failure anchor not found")
    s = s.replace(old_catch, new_catch, 1)
file_reader.write_text(s, encoding="utf-8")

# Probe the exact Character Select top-level loads. If the lower-case alias is
# sufficient this becomes positive proof; otherwise the global FileReader
# probe above tells us which nested asset is still missing.
char_select = Path("openko/src/Client/WarFare/GameProcCharacterSelect.cpp")
s = char_select.read_text(encoding="utf-8-sig")
include_anchor = '#include "NetworkEncoding.h"\n'
include_probe = '#include "NetworkEncoding.h"\n#ifdef __EMSCRIPTEN__\n#include <spdlog/spdlog.h>\n#endif\n'
if "#include <spdlog/spdlog.h>" not in s:
    if include_anchor not in s:
        raise SystemExit("Character Select include anchor not found")
    s = s.replace(include_anchor, include_probe, 1)

ui_anchor = '''\tif (pTbl)
\t\tm_pUICharacterSelect->LoadFromFile(pTbl->szCharacterSelect); // UI Manager 에 넣지 않고 따로 처리한다... 이유가 있다..
'''
ui_probe = '''\tif (pTbl)
\t{
#ifdef __EMSCRIPTEN__
\t\tspdlog::info("character-select UI path='{}' load={}", pTbl->szCharacterSelect, m_pUICharacterSelect->LoadFromFile(pTbl->szCharacterSelect));
#else
\t\tm_pUICharacterSelect->LoadFromFile(pTbl->szCharacterSelect); // UI Manager 에 넣지 않고 따로 처리한다... 이유가 있다..
#endif
\t}
'''
if "character-select UI path=" not in s:
    if ui_anchor not in s:
        raise SystemExit("Character Select UI load anchor not found")
    s = s.replace(ui_anchor, ui_probe, 1)

el_anchor = '''\t\tcase NATION_ELMORAD:
\t\t\tm_pActiveBg->LoadFromFile("ChrSelect\\\\el_chairs.n3shape");

\t\t\t// Light..
\t\t\tm_pLights[0]->LoadFromFile("ChrSelect\\\\el_light_0.n3light");
\t\t\tm_pLights[1]->LoadFromFile("ChrSelect\\\\el_light_1.n3light");
\t\t\tm_pLights[2]->LoadFromFile("ChrSelect\\\\el_light_2.n3light");
'''
el_probe = '''\t\tcase NATION_ELMORAD:
#ifdef __EMSCRIPTEN__
\t\t\tspdlog::info("character-select El Morad background load={}", m_pActiveBg->LoadFromFile("ChrSelect\\\\el_chairs.n3shape"));
\t\t\tspdlog::info("character-select El Morad light0 load={}", m_pLights[0]->LoadFromFile("ChrSelect\\\\el_light_0.n3light"));
\t\t\tspdlog::info("character-select El Morad light1 load={}", m_pLights[1]->LoadFromFile("ChrSelect\\\\el_light_1.n3light"));
\t\t\tspdlog::info("character-select El Morad light2 load={}", m_pLights[2]->LoadFromFile("ChrSelect\\\\el_light_2.n3light"));
#else
\t\t\tm_pActiveBg->LoadFromFile("ChrSelect\\\\el_chairs.n3shape");
\t\t\tm_pLights[0]->LoadFromFile("ChrSelect\\\\el_light_0.n3light");
\t\t\tm_pLights[1]->LoadFromFile("ChrSelect\\\\el_light_1.n3light");
\t\t\tm_pLights[2]->LoadFromFile("ChrSelect\\\\el_light_2.n3light");
#endif
'''
if "character-select El Morad background load=" not in s:
    if el_anchor not in s:
        raise SystemExit("Character Select El Morad load anchor not found")
    s = s.replace(el_anchor, el_probe, 1)
char_select.write_text(s, encoding="utf-8")

login = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = login.read_text(encoding="utf-8")
anchor = '\tint iServerCount     = GetPrivateProfileInt("Server", "Count", 0, szIniPath);\n'
probe = '''\tint iServerCount     = GetPrivateProfileInt("Server", "Count", 0, szIniPath);
#ifdef __EMSCRIPTEN__
\tspdlog::info("browser Server.Ini: path='{}' count={}", szIniPath, iServerCount);
#endif
'''
if "browser Server.Ini: path=" not in s:
    if anchor not in s:
        raise SystemExit("login Server.Ini count anchor not found")
    s = s.replace(anchor, probe, 1)
login.write_text(s, encoding="utf-8")

print("Browser Server.Ini case fixed; genuine 1298 ChrSelect dual-case mounts, runtime font, and Character Select probes applied")
