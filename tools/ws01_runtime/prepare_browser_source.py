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
require("SDL_GetWindowSizeInPixels(m_pWindow, &m_iWinPixelW, &m_iWinPixelH);" in text,
        "GL present-time framebuffer refresh is missing")

# On a browser resize SDL updates the canvas/default framebuffer immediately.
# Refresh RHIDeviceGL's cached physical dimensions before the first draw after
# that change, not only after SwapWindow/Present, so viewport/scissor/UI mapping
# never spends a frame using stale framebuffer geometry.
if "OldKOWeb live browser framebuffer refresh" not in text:
    apply_anchor = "void RHIDeviceGL::ApplyFixedState()\n{\n"
    apply_repl = r'''void RHIDeviceGL::ApplyFixedState()
{
#ifdef __EMSCRIPTEN__
\t// OldKOWeb live browser framebuffer refresh: SDL/Emscripten can resize the
\t// default canvas between presents (window resize/fullscreen). Refresh the
\t// cached physical geometry before scissor/viewport state is applied.
\tif (!m_bRenderTargetBound)
\t{
\t\tSDL_GetWindowSizeInPixels(m_pWindow, &m_iWinPixelW, &m_iWinPixelH);
\t\tint logicalW = 0, logicalH = 0;
\t\tSDL_GetWindowSize(m_pWindow, &logicalW, &logicalH);
\t\tif (logicalW > 0 && m_iWinPixelW > 0)
\t\t\tm_fPixelDensity = static_cast<float>(m_iWinPixelW) / static_cast<float>(logicalW);
\t}
#endif
'''
    text = replace_once(text, apply_anchor, apply_repl, "RHIDeviceGL live resize anchor changed")

rhi.write_text(text, encoding="utf-8")
require("OldKOWeb live browser framebuffer refresh" in text,
        "pre-draw browser framebuffer refresh is missing")

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

# Link both browser-only configuration bridges before generated Emscripten JS.
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
        '    "-lwebsocket.js"\n'
        '    "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n'
        '    "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_display_pre.js"\n',
        "Emscripten websocket linker anchor changed",
    )
elif display_marker not in cmake_text:
    cmake_text = replace_once(
        cmake_text,
        '    "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n',
        '    "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_transport_pre.js"\n'
        '    "SHELL:--pre-js ${CMAKE_SOURCE_DIR}/../tools/ws01_runtime/browser_display_pre.js"\n',
        "Emscripten display pre-js insertion anchor changed",
    )
cmake.write_text(cmake_text, encoding="utf-8")

for marker in (
    "-lwebsocket.js",
    "SHELL:--pre-js",
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

# Replace the browser baseline's fixed 1024x768 assumption with a native SDL
# logical/backing resolution chosen by the browser display bridge. The engine
# remains authoritative: JS only reports the desired viewport; SDL owns the
# canvas/window size, RHI owns the GL viewport, and native desktop builds are
# left untouched.
main = Path("openko/src/Client/WarFare/WarFareMainSDL.cpp")
require(main.is_file(), f"missing {main}")
main_text = main.read_text(encoding="utf-8")
require('spdlog::info("render backend: {}"' in main_text, "render backend runtime probe is missing")
require("RHIDeviceGL" in main_text, "OpenGL runtime device is missing")

if "OldKOWebResolveBrowserDisplaySize" not in main_text:
    main_text = replace_once(
        main_text,
        "#include <SDL3/SDL_main.h>\n",
        "#include <SDL3/SDL_main.h>\n\n#ifdef __EMSCRIPTEN__\n#include <emscripten/emscripten.h>\n#endif\n",
        "WarFareMainSDL Emscripten include anchor changed",
    )

    display_bridge = r'''#ifdef __EMSCRIPTEN__
EM_JS(int, OldKOWebResolveBrowserDisplaySize, (int* widthOut, int* heightOut), {
    try {
        if (typeof Module !== 'object' || typeof Module.oldkoResolveDisplaySize !== 'function')
            return 0;
        const resolved = Module.oldkoResolveDisplaySize();
        const width = resolved && Number(resolved.width);
        const height = resolved && Number(resolved.height);
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
            return 0;
        HEAP32[widthOut >> 2] = width;
        HEAP32[heightOut >> 2] = height;
        return 1;
    } catch (error) {
        console.error('[OldKOWeb display] ' + (error && error.message ? error.message : error));
        return 0;
    }
});

EM_JS(void, OldKOWebReportBrowserDisplayGeometry,
    (int logicalW, int logicalH, int framebufferW, int framebufferH,
     int viewportW, int viewportH, double pixelDensity), {
    if (typeof Module !== 'object') return;
    const state = Module.oldkoDisplayState || (Module.oldkoDisplayState = {});
    state.logicalWidth = logicalW;
    state.logicalHeight = logicalH;
    state.framebufferWidth = framebufferW;
    state.framebufferHeight = framebufferH;
    state.viewportWidth = viewportW;
    state.viewportHeight = viewportH;
    state.pixelDensity = pixelDensity;
    state.canvasWidth = Module.canvas ? Module.canvas.width : 0;
    state.canvasHeight = Module.canvas ? Module.canvas.height : 0;
});
#endif

'''
    main_text = replace_once(
        main_text,
        "namespace\n{\n",
        display_bridge + "namespace\n{\n",
        "WarFareMainSDL namespace anchor changed",
    )

    globals_anchor = "SDL_Window* g_pWindow      = nullptr;\nbool g_bWindowInFocus      = true;\nbool g_bQuitRequested      = false;\n"
    display_helpers = r'''SDL_Window* g_pWindow      = nullptr;
bool g_bWindowInFocus      = true;
bool g_bQuitRequested      = false;

#ifdef __EMSCRIPTEN__
bool OldKOWebReadBrowserDisplaySize(int& width, int& height)
{
    int requestedW = 0;
    int requestedH = 0;
    if (!OldKOWebResolveBrowserDisplaySize(&requestedW, &requestedH))
        return false;
    if (requestedW < 1 || requestedH < 1)
        return false;
    width = requestedW;
    height = requestedH;
    return true;
}

void OldKOWebApplyInitialBrowserDisplayOptions()
{
    int width = 1024;
    int height = 768;
    if (!OldKOWebReadBrowserDisplaySize(width, height))
        spdlog::warn("OldKOWeb display resolver unavailable; keeping classic 1024x768 fallback");

    CN3Base::s_Options.iViewWidth = width;
    CN3Base::s_Options.iViewHeight = height;
    CN3Base::s_Options.bWindowMode = true;
    CN3Base::s_Options.bWindowCursor = false;
    spdlog::info("OldKOWeb browser native display target: {}x{}", width, height);
}

void OldKOWebSyncBrowserDisplay(SDL_Window* pWindow, IRHIDevice* pDevice, bool force)
{
    if (pWindow == nullptr || pDevice == nullptr)
        return;

    int desiredW = 0;
    int desiredH = 0;
    if (!OldKOWebReadBrowserDisplaySize(desiredW, desiredH))
        return;

    int logicalW = 0;
    int logicalH = 0;
    SDL_GetWindowSize(pWindow, &logicalW, &logicalH);
    const bool changed = desiredW != logicalW || desiredH != logicalH;
    if (changed)
    {
        if (!SDL_SetWindowSize(pWindow, desiredW, desiredH))
        {
            spdlog::warn("OldKOWeb browser resize {}x{} failed: {}", desiredW, desiredH, SDL_GetError());
            return;
        }
        SDL_SyncWindow(pWindow);
        SDL_GetWindowSize(pWindow, &logicalW, &logicalH);
    }

    if (logicalW < 1 || logicalH < 1)
        return;

    int framebufferW = 0;
    int framebufferH = 0;
    SDL_GetWindowSizeInPixels(pWindow, &framebufferW, &framebufferH);
    const float pixelDensity = (logicalW > 0 && framebufferW > 0)
        ? static_cast<float>(framebufferW) / static_cast<float>(logicalW)
        : 1.0f;

    if (force || changed
        || logicalW != CN3Base::s_Options.iViewWidth
        || logicalH != CN3Base::s_Options.iViewHeight)
    {
        CN3Base::s_Options.iViewWidth = logicalW;
        CN3Base::s_Options.iViewHeight = logicalH;
        CN3Base::s_fPixelDensity = pixelDensity;

        D3DVIEWPORT9 viewport = {};
        viewport.X = 0;
        viewport.Y = 0;
        viewport.Width = static_cast<DWORD>(logicalW);
        viewport.Height = static_cast<DWORD>(logicalH);
        viewport.MinZ = 0.0f;
        viewport.MaxZ = 1.0f;
        pDevice->SetViewport(&viewport);

        spdlog::info("OldKOWeb browser display sync: logical {}x{}, framebuffer {}x{}, density {:.3f}",
            logicalW, logicalH, framebufferW, framebufferH, pixelDensity);
    }

    D3DVIEWPORT9 activeViewport = {};
    pDevice->GetViewport(&activeViewport);
    OldKOWebReportBrowserDisplayGeometry(
        logicalW, logicalH, framebufferW, framebufferH,
        static_cast<int>(activeViewport.Width), static_cast<int>(activeViewport.Height),
        static_cast<double>(pixelDensity));
}
#endif
'''
    main_text = replace_once(
        main_text,
        globals_anchor,
        display_helpers,
        "WarFareMainSDL globals anchor changed",
    )

fixed_options = '''#ifdef __EMSCRIPTEN__\n\tCN3Base::s_Options.iViewWidth    = 1024;\n\tCN3Base::s_Options.iViewHeight   = 768;\n\tCN3Base::s_Options.bWindowMode   = true;\n\tCN3Base::s_Options.bWindowCursor = false;\n#endif'''
dynamic_options = '''#ifdef __EMSCRIPTEN__\n\tOldKOWebApplyInitialBrowserDisplayOptions();\n#endif'''
if fixed_options in main_text:
    main_text = replace_once(
        main_text,
        fixed_options,
        dynamic_options,
        "fixed 1024x768 browser option block changed",
    )
elif "OldKOWebApplyInitialBrowserDisplayOptions();" not in main_text:
    raise SystemExit("RUNTIME_SOURCE_FAIL: browser display option anchor changed")

# Browser fullscreen must be entered/exited from a real browser input event.
# browser_display_pre.js handles Alt+Enter on keydown and fullscreenchange then
# feeds the resulting viewport back to this native resize path. Desktop SDL
# fullscreen behavior remains exactly as upstream.
old_toggle = '''\t\t\tCN3Base::s_Options.bWindowMode = !CN3Base::s_Options.bWindowMode;\n\t\t\tSDL_SetWindowFullscreen(g_pWindow, !CN3Base::s_Options.bWindowMode);\n\t\t\tspdlog::info("toggled to {}", CN3Base::s_Options.bWindowMode ? "windowed" : "fullscreen");'''
new_toggle = '''#ifdef __EMSCRIPTEN__\n\t\t\tspdlog::info("browser fullscreen toggle delegated to OldKOWeb display bridge");\n#else\n\t\t\tCN3Base::s_Options.bWindowMode = !CN3Base::s_Options.bWindowMode;\n\t\t\tSDL_SetWindowFullscreen(g_pWindow, !CN3Base::s_Options.bWindowMode);\n\t\t\tspdlog::info("toggled to {}", CN3Base::s_Options.bWindowMode ? "windowed" : "fullscreen");\n#endif'''
if "browser fullscreen toggle delegated to OldKOWeb display bridge" not in main_text:
    main_text = replace_once(main_text, old_toggle, new_toggle, "browser fullscreen toggle anchor changed")

# Synchronize SDL logical size, canvas backing store, engine options and the
# full RHI viewport after construction and on browser resize/fullscreen events.
post_device_anchor = '''\tCN3Base::RHIDeviceSet(pRHIDevice.get());\n\tspdlog::info("render backend: {}", szBackendName);\n'''
post_device_repl = '''\tCN3Base::RHIDeviceSet(pRHIDevice.get());\n\tspdlog::info("render backend: {}", szBackendName);\n#ifdef __EMSCRIPTEN__\n\tOldKOWebSyncBrowserDisplay(g_pWindow, pRHIDevice.get(), true);\n#endif\n'''
if "OldKOWebSyncBrowserDisplay(g_pWindow, pRHIDevice.get(), true);" not in main_text:
    main_text = replace_once(main_text, post_device_anchor, post_device_repl,
                             "initial browser display sync anchor changed")

poll_anchor = '''\t\tif (g_bQuitRequested)\n\t\t\tbreak;\n\n\t\tlocalInput.Tick();'''
poll_repl = '''\t\tif (g_bQuitRequested)\n\t\t\tbreak;\n\n#ifdef __EMSCRIPTEN__\n\t\tOldKOWebSyncBrowserDisplay(g_pWindow, pRHIDevice.get(), false);\n#endif\n\n\t\tlocalInput.Tick();'''
if "OldKOWebSyncBrowserDisplay(g_pWindow, pRHIDevice.get(), false);" not in main_text:
    main_text = replace_once(main_text, poll_anchor, poll_repl,
                             "per-frame browser display sync anchor changed")

main.write_text(main_text, encoding="utf-8")

for marker in (
    "OldKOWebResolveBrowserDisplaySize",
    "OldKOWebApplyInitialBrowserDisplayOptions",
    "OldKOWebSyncBrowserDisplay",
    "SDL_SetWindowSize(pWindow, desiredW, desiredH)",
    "pDevice->SetViewport(&viewport)",
    "OldKOWebReportBrowserDisplayGeometry",
    "browser fullscreen toggle delegated to OldKOWeb display bridge",
):
    require(marker in main_text, f"missing browser display runtime marker: {marker}")

print("RUNTIME_SOURCE_OK WebGL2/GLES3 + filesystem preload + public WSS + native dynamic browser display verified")
