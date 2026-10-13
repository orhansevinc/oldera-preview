#!/usr/bin/env python3
from pathlib import Path

cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = cmake.read_text()
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

print("Browser Server.Ini preload corrected to case-sensitive /data/Server.Ini")
