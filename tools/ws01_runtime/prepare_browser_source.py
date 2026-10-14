#!/usr/bin/env python3
from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"RUNTIME_SOURCE_FAIL: {message}")


def replace_once(text: str, old: str, new: str, message: str) -> str:
    require(old in text, message)
    return text.replace(old, new, 1)


# Keep the existing WebGL2/GLES fixes deterministic.
rhi = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
require(rhi.is_file(), f"missing {rhi}")
text = rhi.read_text(encoding="utf-8")

escaped = r"#version 300 es\nprecision highp float;"
fixed = "#version 300 es\nprecision highp float;"
count = text.count(escaped)
if count:
    require(count == 2, f"expected exactly 2 escaped GLSL ES headers, found {count}")
    text = text.replace(escaped, fixed)
    rhi.write_text(text, encoding="utf-8")
elif text.count(fixed) < 2:
    raise SystemExit("RUNTIME_SOURCE_FAIL: GLSL ES 300 headers are missing")

require("SDL_GL_CONTEXT_PROFILE_ES" in text, "browser GLES profile patch is missing")
require("OldERA WebGL2 pixel conversion" in text, "browser texture conversion patch is missing")

# WS01 public-test transport fix. The baseline browser patch already moves
# CAPISocket from native TCP to Emscripten's WebSocket C API. This layer keeps
# all KO framing/cryption in C++ and replaces only the browser URL selection:
# server host/port -> configured auth/game WebSocket endpoint.
api_socket = Path("openko/src/Client/WarFare/APISocket.cpp")
require(api_socket.is_file(), f"missing {api_socket}")
api_text = api_socket.read_text(encoding="utf-8")
require("BrowserOnOpen" in api_text, "baseline Emscripten CAPISocket patch is missing")

if "OldKOWebResolveWebSocketUrl" not in api_text:
    api_text = replace_once(
        api_text,
        "#include <cstring>\n",
        "#include <cstring>\n#include <cstdlib>\n\n#ifdef __EMSCRIPTEN__\n#include <emscripten/emscripten.h>\n#endif\n",
        "APISocket include anchor changed",
    )

    resolver_bridge = r'''#ifdef __EMSCRIPTEN__
EM_JS(char*, OldKOWebResolveWebSocketUrl, (const char* host, uint32_t port), {
    try {
        if (typeof Module !== 'object' || typeof Module.oldkoResolveTransportUrl !== 'function') {
            console.error('[OldKOWeb transport] runtime resolver is unavailable');
            return 0;
        }
        const url = Module.oldkoResolveTransportUrl(UTF8ToString(host), Number(port));
        if (typeof url !== 'string' || url.length === 0) {
            console.error('[OldKOWeb transport] runtime resolver returned an empty endpoint');
            return 0;
        }
        return stringToNewUTF8(url);
    } catch (error) {
        console.error('[OldKOWeb transport] ' + (error && error.message ? error.message : error));
        return 0;
    }
});
#endif

'''
    api_text = replace_once(
        api_text,
        "namespace\n{\n",
        resolver_bridge + "namespace\n{\n",
        "APISocket namespace anchor changed",
    )

    old_url = '\tconst std::string url = "ws://" + szIP + ":" + std::to_string(dwPort);\n'
    new_url = '''\tchar* resolvedUrl = OldKOWebResolveWebSocketUrl(szIP.c_str(), dwPort);\n\tif (resolvedUrl == nullptr)\n\t{\n#ifdef _N3GAME\n\t\tCLogWriter::Write("browser WebSocket endpoint mapping failed for server target {}:{}", szIP, dwPort);\n#endif\n\t\treturn -1;\n\t}\n\tconst std::string url(resolvedUrl);\n\tstd::free(resolvedUrl);\n'''
    api_text = replace_once(
        api_text,
        old_url,
        new_url,
        "hardcoded browser ws:// URL anchor changed",
    )
    api_socket.write_text(api_text, encoding="utf-8")

require("OldKOWebResolveWebSocketUrl" in api_text, "config-driven browser WebSocket resolver is missing")
require('const std::string url = "ws://" + szIP' not in api_text, "hardcoded plain ws:// host/port transport remains")
require("browser WebSocket endpoint mapping failed" in api_text, "fail-closed endpoint mapping log is missing")

cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
require(cmake.is_file(), f"missing {cmake}")
cmake_text = cmake.read_text(encoding="utf-8")
pre_js_source = Path("tools/ws01_runtime/browser_transport_pre.js")
require(pre_js_source.is_file(), f"missing {pre_js_source}")
pre_js_marker = "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"
if pre_js_marker not in cmake_text:
    cmake_text = replace_once(
        cmake_text,
        '    "-lwebsocket.js"\n',
        '    "-lwebsocket.js"\n    "--pre-js"\n    "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n',
        "Emscripten websocket linker anchor changed",
    )
    cmake.write_text(cmake_text, encoding="utf-8")

for marker in (
    "-lwebsocket.js",
    "--pre-js",
    pre_js_marker,
    "-sMIN_WEBGL_VERSION=2",
    "-sMAX_WEBGL_VERSION=2",
    "-sFULL_ES3=1",
    "-sFORCE_FILESYSTEM=1",
    "-sASYNCIFY",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Data@/data/Data",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/UI_US@/data/UI_US",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/ChrSelect",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/ChrSelect@/data/chrselect",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Fonts@/data/Fonts",
    "--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Server.ini@/data/Server.Ini",
):
    require(marker in cmake_text, f"missing Emscripten linker marker: {marker}")

main = Path("openko/src/Client/WarFare/WarFareMainSDL.cpp")
require(main.is_file(), f"missing {main}")
main_text = main.read_text(encoding="utf-8")
require("CN3Base::s_Options.iViewWidth    = 1024;" in main_text, "browser viewport patch is missing")
require('spdlog::info("render backend: {}"' in main_text, "render backend runtime probe is missing")
require("RHIDeviceGL" in main_text, "OpenGL runtime device is missing")

print("RUNTIME_SOURCE_OK WebGL2/GLES3 + filesystem preload + config-driven auth/game WebSocket transport verified")
