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
    new_url = '''\tchar* resolvedUrl = OldKOWebResolveWebSocketUrl(szIP.c_str(), dwPort);
\tif (resolvedUrl == nullptr)
\t{
#ifdef _N3GAME
\t\tCLogWriter::Write("browser WebSocket endpoint mapping failed for server target {}:{}", szIP, dwPort);
#endif
\t\treturn -1;
\t}
\tconst std::string url(resolvedUrl);
\tstd::free(resolvedUrl);
'''
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

transport_pre_js = Path("tools/ws01_runtime/browser_transport_pre.js")
display_pre_js = Path("tools/ws01_runtime/browser_display_pre.js")
require(transport_pre_js.is_file(), f"missing {transport_pre_js}")
require(display_pre_js.is_file(), f"missing {display_pre_js}")

transport_marker = "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"
display_marker = "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_display_pre.js"

if transport_marker not in cmake_text:
    cmake_text = replace_once(
        cmake_text,
        '    "-lwebsocket.js"\n',
        '    "-lwebsocket.js"\n    "--pre-js"\n    "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n',
        "Emscripten websocket linker anchor changed",
    )

if display_marker not in cmake_text:
    cmake_text = replace_once(
        cmake_text,
        '    "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n',
        '    "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n'
        '    "--pre-js"\n'
        '    "${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_display_pre.js"\n',
        "Emscripten display pre-js anchor changed",
    )

cmake.write_text(cmake_text, encoding="utf-8")

for marker in (
    "-lwebsocket.js",
    "--pre-js",
    transport_marker,
    display_marker,
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

if "#include <N3Base/N3Eng.h>" not in main_text:
    main_text = replace_once(
        main_text,
        "#include <N3Base/N3Base.h>\n",
        "#include <N3Base/N3Base.h>\n#include <N3Base/N3Eng.h>\n",
        "WarFareMainSDL N3Eng include anchor changed",
    )

if "#include <emscripten/emscripten.h>" not in main_text:
    main_text = replace_once(
        main_text,
        "#include <SDL3/SDL_main.h>\n",
        "#include <SDL3/SDL_main.h>\n\n#ifdef __EMSCRIPTEN__\n#include <emscripten/emscripten.h>\n#endif\n",
        "WarFareMainSDL Emscripten include anchor changed",
    )

if "OldKOWebGetBrowserDisplaySize" not in main_text:
    bridge = r'''#ifdef __EMSCRIPTEN__
EM_JS(int, OldKOWebGetBrowserDisplaySize, (int* pWidth, int* pHeight), {
    try {
        if (typeof Module !== 'object' || typeof Module.oldkoResolveDisplaySize !== 'function')
            return 0;
        const size = Module.oldkoResolveDisplaySize();
        const width = Number(size && size.width);
        const height = Number(size && size.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1)
            return 0;
        HEAP32[pWidth >> 2] = Math.floor(width);
        HEAP32[pHeight >> 2] = Math.floor(height);
        return 1;
    } catch (error) {
        console.error('[OldKOWeb display] ' + (error && error.message ? error.message : error));
        return 0;
    }
});
#endif

'''
    main_text = replace_once(
        main_text,
        "namespace\n{\n",
        bridge + "namespace\n{\n",
        "WarFareMainSDL namespace anchor changed",
    )

if "void SyncBrowserDisplay(IRHIDevice* pRHIDevice)" not in main_text:
    helper_anchor = "bool g_bQuitRequested      = false;\n"
    helper = r'''bool g_bQuitRequested      = false;

#ifdef __EMSCRIPTEN__
bool QueryBrowserDisplaySize(int& width, int& height)
{
    width = 1024;
    height = 768;
    return OldKOWebGetBrowserDisplaySize(&width, &height) != 0
        && width > 0 && height > 0;
}

void SyncBrowserDisplay(IRHIDevice* pRHIDevice)
{
    if (g_pWindow == nullptr)
        return;

    int desiredW = 0, desiredH = 0;
    if (!QueryBrowserDisplaySize(desiredW, desiredH))
        return;

    int currentW = 0, currentH = 0;
    SDL_GetWindowSize(g_pWindow, &currentW, &currentH);
    if (currentW == desiredW && currentH == desiredH
        && CN3Base::s_Options.iViewWidth == desiredW
        && CN3Base::s_Options.iViewHeight == desiredH)
        return;

    if (CN3Base::s_Options.bWindowMode && (currentW != desiredW || currentH != desiredH))
    {
        if (!SDL_SetWindowSize(g_pWindow, desiredW, desiredH))
            spdlog::warn("browser display: SDL_SetWindowSize {}x{} failed: {}",
                desiredW, desiredH, SDL_GetError());
    }

    int actualW = 0, actualH = 0;
    SDL_GetWindowSize(g_pWindow, &actualW, &actualH);
    if (actualW <= 0 || actualH <= 0)
        return;

    CN3Base::s_Options.iViewWidth = actualW;
    CN3Base::s_Options.iViewHeight = actualH;

    if (auto* pGL = dynamic_cast<RHIDeviceGL*>(pRHIDevice))
        pGL->SyncWindowGeometry();

    if (CGameProcedure::s_pEng != nullptr)
    {
        CGameProcedure::s_pEng->SetProjection(0.1f, 256.0f, DegreesToRadians(45.0f),
            static_cast<float>(actualH) / static_cast<float>(actualW));
        RECT rcView = { 0, 0, actualW, actualH };
        CGameProcedure::s_pEng->SetViewPort(rcView);
    }

    int pixelW = 0, pixelH = 0;
    SDL_GetWindowSizeInPixels(g_pWindow, &pixelW, &pixelH);
    spdlog::info("browser display sync: logical {}x{} framebuffer {}x{}",
        actualW, actualH, pixelW, pixelH);
}
#endif
'''
    main_text = replace_once(
        main_text,
        helper_anchor,
        helper,
        "WarFareMainSDL browser display helper anchor changed",
    )

fixed_viewport = '''#ifdef __EMSCRIPTEN__
\tCN3Base::s_Options.iViewWidth    = 1024;
\tCN3Base::s_Options.iViewHeight   = 768;
\tCN3Base::s_Options.bWindowMode   = true;
\tCN3Base::s_Options.bWindowCursor = false;
#endif
'''
dynamic_viewport = '''#ifdef __EMSCRIPTEN__
\tint browserWidth = 1024, browserHeight = 768;
\tconst bool browserSizeResolved = QueryBrowserDisplaySize(browserWidth, browserHeight);
\tCN3Base::s_Options.iViewWidth    = browserWidth;
\tCN3Base::s_Options.iViewHeight   = browserHeight;
\tCN3Base::s_Options.bWindowMode   = true;
\tCN3Base::s_Options.bWindowCursor = false;
\tspdlog::info("browser display initial: {}x{} ({})", browserWidth, browserHeight,
\t\tbrowserSizeResolved ? "runtime" : "classic fallback");
#endif
'''
if fixed_viewport in main_text:
    main_text = replace_once(
        main_text,
        fixed_viewport,
        dynamic_viewport,
        "fixed 1024x768 browser viewport anchor changed",
    )

require("CN3Base::s_Options.iViewWidth    = 1024;" not in main_text,
        "fixed browser 1024 width override remains")
require("CN3Base::s_Options.iViewHeight   = 768;" not in main_text,
        "fixed browser 768 height override remains")
require("browser display initial:" in main_text, "initial browser display resolution hook is missing")
require("SyncBrowserDisplay" in main_text, "runtime browser resize hook is missing")

poll_anchor = '''\t\tSDL_Event event;
\t\twhile (SDL_PollEvent(&event))
\t\t\tHandleEvent(event);

\t\tif (g_bQuitRequested)
'''
poll_repl = '''\t\tSDL_Event event;
\t\twhile (SDL_PollEvent(&event))
\t\t\tHandleEvent(event);

#ifdef __EMSCRIPTEN__
\t\tSyncBrowserDisplay(pRHIDevice.get());
#endif

\t\tif (g_bQuitRequested)
'''
if "SyncBrowserDisplay(pRHIDevice.get());" not in main_text:
    main_text = replace_once(
        main_text,
        poll_anchor,
        poll_repl,
        "WarFareMainSDL event-pump resize anchor changed",
    )

toggle_anchor = '''\t\t\tSDL_SetWindowFullscreen(g_pWindow, !CN3Base::s_Options.bWindowMode);
\t\t\tspdlog::info("toggled to {}", CN3Base::s_Options.bWindowMode ? "windowed" : "fullscreen");
\t\t}
'''
toggle_repl = '''\t\t\tSDL_SetWindowFullscreen(g_pWindow, !CN3Base::s_Options.bWindowMode);
\t\t\tspdlog::info("toggled to {}", CN3Base::s_Options.bWindowMode ? "windowed" : "fullscreen");
#ifdef __EMSCRIPTEN__
\t\t\tSyncBrowserDisplay(pRHIDevice.get());
#endif
\t\t}
'''
if main_text.count("SyncBrowserDisplay(pRHIDevice.get());") < 2:
    main_text = replace_once(
        main_text,
        toggle_anchor,
        toggle_repl,
        "WarFareMainSDL fullscreen resize anchor changed",
    )

main.write_text(main_text, encoding="utf-8")

rhi_header = Path("openko/src/Client/WarFare/RHIDeviceGL.h")
require(rhi_header.is_file(), f"missing {rhi_header}")
rhi_header_text = rhi_header.read_text(encoding="utf-8")
if "void SyncWindowGeometry();" not in rhi_header_text:
    rhi_header_text = replace_once(
        rhi_header_text,
        "\tHRESULT Present() override;\n",
        "\tHRESULT Present() override;\n\tvoid SyncWindowGeometry();\n",
        "RHIDeviceGL public geometry sync anchor changed",
    )
    rhi_header.write_text(rhi_header_text, encoding="utf-8")

rhi_text = rhi.read_text(encoding="utf-8")
old_present = '''HRESULT RHIDeviceGL::Present()
{
\tSDL_GL_SwapWindow(m_pWindow);

\t// The window can change size at runtime (Alt+Enter windowed/fullscreen
\t// toggle, window-manager resizes); the cached pixel size feeds the
\t// Y-flip in SetViewport/SetScissorRect and the RHW mapping, so refresh
\t// it once per frame rather than trusting the size captured at init.
\t// The pixel density can change too (window dragged between displays).
\tSDL_GetWindowSizeInPixels(m_pWindow, &m_iWinPixelW, &m_iWinPixelH);
\tint wPoints = 0, hPoints = 0;
\tSDL_GetWindowSize(m_pWindow, &wPoints, &hPoints);
\tif (wPoints > 0 && m_iWinPixelW > 0)
\t\tm_fPixelDensity = static_cast<float>(m_iWinPixelW) / static_cast<float>(wPoints);

\treturn RHIDeviceNull::Present(); // keep the present counter for diagnostics
}
'''
new_present = '''void RHIDeviceGL::SyncWindowGeometry()
{
\tif (m_pWindow == nullptr || m_bRenderTargetBound)
\t\treturn;

\tint pixelW = 0, pixelH = 0;
\tSDL_GetWindowSizeInPixels(m_pWindow, &pixelW, &pixelH);
\tif (pixelW <= 0 || pixelH <= 0)
\t\treturn;

\tm_iWinPixelW = pixelW;
\tm_iWinPixelH = pixelH;

\tint wPoints = 0, hPoints = 0;
\tSDL_GetWindowSize(m_pWindow, &wPoints, &hPoints);
\tif (wPoints > 0)
\t\tm_fPixelDensity = static_cast<float>(m_iWinPixelW) / static_cast<float>(wPoints);
}

HRESULT RHIDeviceGL::Present()
{
\tSyncWindowGeometry();
\tSDL_GL_SwapWindow(m_pWindow);
\tSyncWindowGeometry();

\treturn RHIDeviceNull::Present(); // keep the present counter for diagnostics
}
'''
if "void RHIDeviceGL::SyncWindowGeometry()" not in rhi_text:
    rhi_text = replace_once(
        rhi_text,
        old_present,
        new_present,
        "RHIDeviceGL runtime geometry refresh anchor changed",
    )
    rhi.write_text(rhi_text, encoding="utf-8")

require("void RHIDeviceGL::SyncWindowGeometry()" in rhi_text,
        "RHIDeviceGL runtime geometry sync implementation is missing")
require("void SyncWindowGeometry();" in rhi_header_text,
        "RHIDeviceGL runtime geometry sync declaration is missing")
require('spdlog::info("render backend: {}"' in main_text, "render backend runtime probe is missing")
require("RHIDeviceGL" in main_text, "OpenGL runtime device is missing")

print("RUNTIME_SOURCE_OK WebGL2/GLES3 + native viewport resize + framebuffer/projection/camera sync + config-driven auth/game WebSocket transport verified")
