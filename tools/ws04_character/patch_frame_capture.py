#!/usr/bin/env python3
"""Add the WS04 Emscripten native GL frame-capture hook to OpenKO.

The browser compositor screenshot API is unreliable while the real SDL/WebGL
main loop is running. WS04 therefore captures the genuine RHIDeviceGL
backbuffer. Present() remains the preferred pre-swap service point; an
Emscripten timer services requests that would otherwise starve while the
browser has yielded inside a long/suspended main-scene frame.

For the Moradon E2E gate the JS driver may set WS04_CAPTURE_PRESENT_ONLY=1.
That arms a request early while JS is still responsive but explicitly prevents
the timer fallback from reading an incomplete preload frame; only the next real
RHIDeviceGL::Present() may service that request.
"""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


cpp = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
s = cpp.read_text(encoding="utf-8")

include_anchor = "#include <vector>\n"
include_patch = """#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#include <emscripten/html5.h>
#endif
"""
s = replace_once(s, include_anchor, include_patch, "Emscripten include")

header = Path("openko/src/Client/WarFare/RHIDeviceGL.h")
h = header.read_text(encoding="utf-8")
private_anchor = """private:
\tstatic constexpr DWORD MAX_GL_STAGES = 3; // terrain uses stages 0..2
"""
private_patch = """private:
#ifdef __EMSCRIPTEN__
\tvoid WS04ServiceCaptureRequest(const char* source, bool deferFromTimer);
\tstatic void WS04CaptureTimerThunk(void* userData);
\tlong m_lWS04CaptureTimer = 0;
\tint m_iWS04DeferredCaptureID = 0;
\tint m_iWS04DeferredCaptureTicks = 0;
#endif

\tstatic constexpr DWORD MAX_GL_STAGES = 3; // terrain uses stages 0..2
"""
h = replace_once(h, private_anchor, private_patch, "WS04 device capture declarations")
header.write_text(h, encoding="utf-8")

ctor_anchor = """\tspdlog::info("RHIDeviceGL: S3TC {}, max texture size {}",
\t\tm_bS3TC ? "supported" : "NOT supported", maxTexSize);
\tm_bValid = true;
}
"""
ctor_patch = """\tspdlog::info("RHIDeviceGL: S3TC {}, max texture size {}",
\t\tm_bS3TC ? "supported" : "NOT supported", maxTexSize);
\tm_bValid = true;
#ifdef __EMSCRIPTEN__
\tm_lWS04CaptureTimer = emscripten_set_interval(
\t\t&RHIDeviceGL::WS04CaptureTimerThunk, 50.0, this);
#endif
}
"""
s = replace_once(s, ctor_anchor, ctor_patch, "WS04 browser capture timer install")

dtor_anchor = """RHIDeviceGL::~RHIDeviceGL()
{
\tif (m_pGLContext != nullptr)
"""
dtor_patch = """RHIDeviceGL::~RHIDeviceGL()
{
#ifdef __EMSCRIPTEN__
\tif (m_lWS04CaptureTimer != 0)
\t{
\t\temscripten_clear_interval(m_lWS04CaptureTimer);
\t\tm_lWS04CaptureTimer = 0;
\t}
#endif

\tif (m_pGLContext != nullptr)
"""
s = replace_once(s, dtor_anchor, dtor_patch, "WS04 browser capture timer cleanup")

present_anchor = """HRESULT RHIDeviceGL::Present()
{
\tSDL_GL_SwapWindow(m_pWindow);
"""
present_patch = '''#ifdef __EMSCRIPTEN__
void RHIDeviceGL::WS04CaptureTimerThunk(void* userData)
{
\tauto* pDevice = static_cast<RHIDeviceGL*>(userData);
\tif (pDevice != nullptr && pDevice->m_bValid)
\t\tpDevice->WS04ServiceCaptureRequest("browser-timer", true);
}

void RHIDeviceGL::WS04ServiceCaptureRequest(const char* source, bool deferFromTimer)
{
\tconst int ws04CaptureRequest = EM_ASM_INT({
\t\treturn (Number(globalThis.WS04_CAPTURE_REQUEST || 0) | 0);
\t});

\tif (ws04CaptureRequest <= 0)
\t{
\t\tif (deferFromTimer)
\t\t{
\t\t\tm_iWS04DeferredCaptureID = 0;
\t\t\tm_iWS04DeferredCaptureTicks = 0;
\t\t}
\t\treturn;
\t}

\t// A world-transition proof can arm the request while JS is responsive but
\t// require that only the next genuine Present() services it. This prevents
\t// the timer fallback from invoking a synchronous glReadPixels/DumpFramePPM
\t// halfway through the Moradon resource-preload phase.
\tif (deferFromTimer)
\t{
\t\tconst int ws04PresentOnly = EM_ASM_INT({
\t\t\treturn globalThis.WS04_CAPTURE_PRESENT_ONLY ? 1 : 0;
\t\t});
\t\tif (ws04PresentOnly != 0)
\t\t{
\t\t\tm_iWS04DeferredCaptureID = 0;
\t\t\tm_iWS04DeferredCaptureTicks = 0;
\t\t\treturn;
\t\t}
\t}

\t// Present() always wins immediately. The timer is only a starvation
\t// fallback for ordinary proof captures when PRESENT_ONLY is not requested.
\tif (deferFromTimer)
\t{
\t\tif (m_iWS04DeferredCaptureID != ws04CaptureRequest)
\t\t{
\t\t\tm_iWS04DeferredCaptureID = ws04CaptureRequest;
\t\t\tm_iWS04DeferredCaptureTicks = 1;
\t\t\treturn;
\t\t}

\t\tif (++m_iWS04DeferredCaptureTicks < 10)
\t\t\treturn;
\t}

\tconst int ws04ClaimedRequest = EM_ASM_INT({
\t\tconst requested = Number(globalThis.WS04_CAPTURE_REQUEST || 0) | 0;
\t\tconst wanted = $0 | 0;
\t\tconst inflight = Number(globalThis.WS04_CAPTURE_INFLIGHT || 0) | 0;
\t\tif (requested !== wanted || inflight !== 0)
\t\t\treturn 0;
\t\tglobalThis.WS04_CAPTURE_INFLIGHT = wanted;
\t\treturn wanted;
\t}, ws04CaptureRequest);
\tif (ws04ClaimedRequest != ws04CaptureRequest)
\t\treturn;

\tm_iWS04DeferredCaptureID = 0;
\tm_iWS04DeferredCaptureTicks = 0;

\tchar ws04Path[96] = {};
\tstd::snprintf(ws04Path, sizeof(ws04Path), "/ws04-frame-%d.ppm", ws04CaptureRequest);
\tconst bool ws04Ok = DumpFramePPM(ws04Path);
\tspdlog::info("WS04_GL_CAPTURE id={} ok={} size={}x{} path='{}' source={}",
\t\tws04CaptureRequest, ws04Ok ? 1 : 0, m_iWinPixelW, m_iWinPixelH, ws04Path, source);

\tEM_ASM({
\t\tconst ok = $0 | 0;
\t\tconst id = $1 | 0;
\t\tglobalThis.WS04_CAPTURE_READY = ok ? id : -id;
\t\tif ((Number(globalThis.WS04_CAPTURE_REQUEST || 0) | 0) === id)
\t\t\tglobalThis.WS04_CAPTURE_REQUEST = 0;
\t\tif ((Number(globalThis.WS04_CAPTURE_INFLIGHT || 0) | 0) === id)
\t\t\tglobalThis.WS04_CAPTURE_INFLIGHT = 0;
\t\tglobalThis.WS04_CAPTURE_PRESENT_ONLY = 0;
\t}, ws04Ok ? 1 : 0, ws04CaptureRequest);
}
#endif

HRESULT RHIDeviceGL::Present()
{
#ifdef __EMSCRIPTEN__
\tWS04ServiceCaptureRequest("present", false);
#endif

\tSDL_GL_SwapWindow(m_pWindow);
'''
s = replace_once(s, present_anchor, present_patch, "Present pre-swap capture service")
cpp.write_text(s, encoding="utf-8")

cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = cmake.read_text(encoding="utf-8")
chr_preload = '    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Chr@/data/Chr"\n'
fs_export = '    "-sEXPORTED_RUNTIME_METHODS=FS"\n'
if fs_export not in s:
    if chr_preload not in s:
        raise SystemExit("WS04 Chr preload anchor missing before MEMFS export")
    s = s.replace(chr_preload, chr_preload + fs_export, 1)
cmake.write_text(s, encoding="utf-8")

print("WS04 pre-swap GL capture + present-only Moradon arming patch applied")
