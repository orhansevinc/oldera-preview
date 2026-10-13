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

# Extend the existing Emscripten preload set with the genuine 1298 Character
# Select assets plus the runtime font folder.
ui_preload = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/UI_US@/data/UI_US"\n'
extra_preloads = (
    ui_preload
    + '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/ChrSelect"\n'
    + '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Fonts@/data/Fonts"\n'
)
if "ko-assets/ChrSelect@/data/ChrSelect" not in s:
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

print("Browser Server.Ini case fixed; genuine 1298 ChrSelect assets and runtime font preloaded")
