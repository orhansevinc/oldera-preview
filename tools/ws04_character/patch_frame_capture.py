#!/usr/bin/env python3
"""Add a WS04-only Emscripten frame-capture hook to the temporary OpenKO checkout.

The browser's compositor screenshot API is unreliable while the real SDL/WebGL
main loop is running.  This patch captures the actual GL backbuffer *before*
SDL_GL_SwapWindow when the JS driver requests it.  Desktop builds are untouched.
"""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


path = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
s = path.read_text(encoding="utf-8")

include_anchor = "#include <vector>\n"
include_patch = """#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif
"""
s = replace_once(s, include_anchor, include_patch, "Emscripten include")

present_anchor = """HRESULT RHIDeviceGL::Present()
{
\tSDL_GL_SwapWindow(m_pWindow);
"""
present_patch = r'''HRESULT RHIDeviceGL::Present()
{
#ifdef __EMSCRIPTEN__
	// WS04 visual proof must observe the frame while it is still the GL back
	// buffer.  Chromium may discard that buffer immediately after presentation,
	// which made CDP/readPixels-after-swap evidence flaky/black.  The JS driver
	// requests a numbered capture; the existing real RHI DumpFramePPM() writes
	// exactly what the KO renderer drew, before SDL swaps it away.
	const int ws04CaptureRequest = EM_ASM_INT({
		return (globalThis.WS04_CAPTURE_REQUEST || 0) | 0;
	});
	if (ws04CaptureRequest > 0)
	{
		char ws04Path[96] = {};
		std::snprintf(ws04Path, sizeof(ws04Path), "/ws04-frame-%d.ppm", ws04CaptureRequest);
		const bool ws04Ok = DumpFramePPM(ws04Path);
		spdlog::info("WS04_GL_CAPTURE id={} ok={} size={}x{} path='{}'",
			ws04CaptureRequest, ws04Ok ? 1 : 0, m_iWinPixelW, m_iWinPixelH, ws04Path);
		EM_ASM({
			globalThis.WS04_CAPTURE_READY = $0 ? $1 : -$1;
			globalThis.WS04_CAPTURE_REQUEST = 0;
		}, ws04Ok ? 1 : 0, ws04CaptureRequest);
	}
#endif

	SDL_GL_SwapWindow(m_pWindow);
'''
s = replace_once(s, present_anchor, present_patch, "Present pre-swap capture")

path.write_text(s, encoding="utf-8")
print("WS04 deterministic pre-swap GL frame capture patch applied")
