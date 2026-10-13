#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: upstream/control patch anchor changed")
    return text.replace(old, new, 1)


# The first browser milestone intentionally bypassed networking so the real
# 1298 login scene could be rendered without a login server. Re-enable the
# original CAPISocket path in Emscripten. Emscripten maps POSIX TCP sockets to
# binary WebSockets; gateway/oldera-gateway.mjs terminates that WebSocket and
# forwards the exact bytes to the KO TCP login server.
p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8")
old_begin = '''#ifdef __EMSCRIPTEN__
\t(void) iServer;
\tm_pUILogIn->FocusToID();
\tspdlog::info("browser login scene ready; network deferred to WebSocket gateway");
#else
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
new_begin = '''#ifdef __EMSCRIPTEN__
\tspdlog::info("browser login transport active: KO socket -> WebSocket gateway");
#endif
\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)
\t{'''
if "browser login transport active: KO socket -> WebSocket gateway" not in s:
    s = replace_once(s, old_begin, new_begin, "browser login bridge begin")
    s = replace_once(
        s,
        '''\t}\n#endif\n\n\t// 게임 계정으로 들어 왔으면..''',
        '''\t}\n\n\t// 게임 계정으로 들어 왔으면..''',
        "browser login bridge end",
    )
p.write_text(s, encoding="utf-8")

# Link Emscripten's WebSocket support explicitly. The browser cannot open raw
# TCP; its POSIX socket shim turns connect(127.0.0.1:15100) into a binary
# WebSocket. In production the public gateway endpoint will replace the local
# address without changing KO packet framing or game procedures.
p = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = p.read_text()
if '"-lwebsocket.js"' not in s:
    s = replace_once(
        s,
        '    "-sMIN_WEBGL_VERSION=2"\n',
        '    "-lwebsocket.js"\n    "-sMIN_WEBGL_VERSION=2"\n',
        "Emscripten websocket linker option",
    )
p.write_text(s)

print("OldERA login bridge patch applied: real CAPISocket -> Emscripten WebSocket gateway")
