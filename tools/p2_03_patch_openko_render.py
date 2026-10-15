#!/usr/bin/env python3
# P2-03: patch accepted OpenKO source for browser-native render sizing.
from pathlib import Path
import re
import sys

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openko")
MAIN = ROOT / "src/Client/WarFare/WarFareMainSDL.cpp"
RHI = ROOT / "src/Client/WarFare/RHIDeviceGL.cpp"

MAIN_MARKER = "P2-03 browser render surface"
RHI_MARKER = "P2-03 browser drawable metrics"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


def patch_main(text: str) -> str:
    if MAIN_MARKER in text:
        return text

    hard_lock = re.compile(
        r"#ifdef __EMSCRIPTEN__\s*"
        r"CN3Base::s_Options\.iViewWidth\s*=\s*1024;\s*"
        r"CN3Base::s_Options\.iViewHeight\s*=\s*768;\s*"
        r"CN3Base::s_Options\.bWindowMode\s*=\s*true;\s*"
        r"CN3Base::s_Options\.bWindowCursor\s*=\s*false;\s*"
        r"#endif"
    )
    matches = list(hard_lock.finditer(text))
    if len(matches) != 1:
        raise SystemExit(f"WS05 1024x768 browser lock: expected one block, found {len(matches)}")
    text = hard_lock.sub(
        "#ifdef __EMSCRIPTEN__\n"
        "\t// P2-03 browser render surface: CSS size is the logical viewport;\n"
        "\t// backing-store size is selected independently from DPR/quality.\n"
        "\tCN3Base::s_Options.bWindowCursor = false;\n"
        "#endif",
        text,
        count=1,
    )

    include_anchor = "#include <SDL3/SDL_main.h>\n"
    include_block = '''#include <SDL3/SDL_main.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#include <emscripten/html5.h>
#endif

#include <algorithm>
#include <cmath>
'''
    text = replace_once(text, include_anchor, include_block, "main include")

    globals_anchor = '''SDL_Window* g_pWindow      = nullptr;
bool g_bWindowInFocus      = true;
bool g_bQuitRequested      = false;
'''
    helper = r'''SDL_Window* g_pWindow      = nullptr;
bool g_bWindowInFocus      = true;
bool g_bQuitRequested      = false;

#ifdef __EMSCRIPTEN__
// P2-03 browser render surface. Game/UI/picking remain in logical CSS pixels.
// Only the WebGL backing store is multiplied by renderScale.
struct OldKOWebRenderSurface
{
	int logicalW = 0;
	int logicalH = 0;
	int backingW = 0;
	int backingH = 0;
	float dpr = 1.0f;
	float scale = 1.0f;
	const char* quality = "sharp";
};

double OldKOWebCssWidth()
{
	return EM_ASM_DOUBLE({
		const c = (typeof Module !== 'undefined' && Module.canvas)
			? Module.canvas : document.querySelector('#canvas');
		if (!c) return 0;
		const r = c.getBoundingClientRect();
		return r.width;
	});
}

double OldKOWebCssHeight()
{
	return EM_ASM_DOUBLE({
		const c = (typeof Module !== 'undefined' && Module.canvas)
			? Module.canvas : document.querySelector('#canvas');
		if (!c) return 0;
		const r = c.getBoundingClientRect();
		return r.height;
	});
}

const char* OldKOWebQualityName()
{
	const int mode = EM_ASM_INT({
		const q = new URLSearchParams(location.search).get('renderQuality')
			|| window.OLDKO_RENDER_QUALITY
			|| localStorage.getItem('oldkoweb.renderQuality')
			|| 'sharp';
		return q === 'performance' ? 0 : q === 'balanced' ? 1 : q === 'native' ? 3 : 2;
	});
	switch (mode)
	{
		case 0: return "performance";
		case 1: return "balanced";
		case 3: return "native";
		default: return "sharp";
	}
}

float OldKOWebRequestedScale(const char* quality, float dpr)
{
	if (std::strcmp(quality, "performance") == 0) return 1.0f;
	if (std::strcmp(quality, "balanced") == 0) return std::min(dpr, 1.25f);
	if (std::strcmp(quality, "native") == 0) return std::min(dpr, 2.0f);
	return std::min(dpr, 1.5f);
}

double OldKOWebPixelBudget(const char* quality)
{
	if (std::strcmp(quality, "performance") == 0) return 2100000.0;
	if (std::strcmp(quality, "balanced") == 0) return 3200000.0;
	if (std::strcmp(quality, "native") == 0) return 8300000.0;
	return 4700000.0;
}

OldKOWebRenderSurface OldKOWebDesiredRenderSurface()
{
	OldKOWebRenderSurface out;
	out.logicalW = std::max(1, static_cast<int>(std::lround(OldKOWebCssWidth())));
	out.logicalH = std::max(1, static_cast<int>(std::lround(OldKOWebCssHeight())));
	out.dpr = static_cast<float>(EM_ASM_DOUBLE({ return window.devicePixelRatio || 1; }));
	out.dpr = std::max(1.0f, std::min(out.dpr, 2.0f));
	out.quality = OldKOWebQualityName();

	const float requested = OldKOWebRequestedScale(out.quality, out.dpr);
	const double logicalPixels = static_cast<double>(out.logicalW) * out.logicalH;
	const float budgetScale = static_cast<float>(
		std::sqrt(OldKOWebPixelBudget(out.quality) / std::max(1.0, logicalPixels)));
	out.scale = std::max(1.0f, std::min(requested, budgetScale));
	out.backingW = std::max(1, static_cast<int>(std::lround(out.logicalW * out.scale)));
	out.backingH = std::max(1, static_cast<int>(std::lround(out.logicalH * out.scale)));
	return out;
}

void OldKOWebPublishRenderMetrics(const OldKOWebRenderSurface& s)
{
	EM_ASM({
		const c = (typeof Module !== 'undefined' && Module.canvas)
			? Module.canvas : document.querySelector('#canvas');
		if (!c) return;
		const gl = (typeof Module !== 'undefined' && Module.ctx) ? Module.ctx : null;
		const m = window.__OLDKO_RENDER_METRICS__ || {};
		m.cssWidth = $0; m.cssHeight = $1;
		m.logicalWidth = $0; m.logicalHeight = $1;
		m.backingWidth = $2; m.backingHeight = $3;
		m.drawingBufferWidth = gl ? gl.drawingBufferWidth : c.width;
		m.drawingBufferHeight = gl ? gl.drawingBufferHeight : c.height;
		m.devicePixelRatio = $4;
		m.renderScale = $5;
		m.quality = UTF8ToString($6);
		m.wasmHeapBytes = (typeof HEAP8 !== 'undefined') ? HEAP8.buffer.byteLength : null;
		m.jsHeapBytes = performance.memory ? performance.memory.usedJSHeapSize : null;
		m.renderTargetsEstimateBytes = $2 * $3 * 8;
		window.__OLDKO_RENDER_METRICS__ = m;
	}, s.logicalW, s.logicalH, s.backingW, s.backingH, s.dpr, s.scale, s.quality);
}

void OldKOWebSyncRenderSurface(IRHIDevice* device, bool force)
{
	static OldKOWebRenderSurface previous;
	const OldKOWebRenderSurface next = OldKOWebDesiredRenderSurface();
	const bool changed = force
		|| next.logicalW != previous.logicalW || next.logicalH != previous.logicalH
		|| next.backingW != previous.backingW || next.backingH != previous.backingH
		|| std::abs(next.scale - previous.scale) > 0.001f
		|| std::strcmp(next.quality, previous.quality) != 0;
	if (!changed) return;

	emscripten_set_canvas_element_size("#canvas", next.backingW, next.backingH);
	CN3Base::s_Options.iViewWidth = next.logicalW;
	CN3Base::s_Options.iViewHeight = next.logicalH;
	CN3Base::s_fPixelDensity = next.scale;

	if (device != nullptr)
	{
		D3DVIEWPORT9 vp = {};
		vp.X = 0; vp.Y = 0;
		vp.Width = static_cast<DWORD>(next.logicalW);
		vp.Height = static_cast<DWORD>(next.logicalH);
		vp.MinZ = 0.0f; vp.MaxZ = 1.0f;
		device->SetViewport(&vp);
	}

	OldKOWebPublishRenderMetrics(next);
	spdlog::info(
		"OLDKOWEB_RENDER logical={}x{} backing={}x{} dpr={:.2f} scale={:.2f} quality={}",
		next.logicalW, next.logicalH, next.backingW, next.backingH,
		next.dpr, next.scale, next.quality);
	previous = next;
}

void OldKOWebPublishFrameTime()
{
	static double lastMs = 0.0;
	static double emaMs = 0.0;
	const double nowMs = emscripten_get_now();
	if (lastMs > 0.0)
	{
		const double dt = std::max(0.01, nowMs - lastMs);
		emaMs = emaMs <= 0.0 ? dt : (emaMs * 0.9 + dt * 0.1);
		EM_ASM({
			const m = window.__OLDKO_RENDER_METRICS__ || {};
			m.frameTimeMs = $0;
			m.fps = $0 > 0 ? 1000 / $0 : 0;
			window.__OLDKO_RENDER_METRICS__ = m;
		}, emaMs);
	}
	lastMs = nowMs;
}
#endif
'''
    text = replace_once(text, globals_anchor, helper, "main globals")

    device_anchor = '''\tCN3Base::RHIDeviceSet(pRHIDevice.get());
\tspdlog::info("render backend: {}", szBackendName);
'''
    device_patch = '''\tCN3Base::RHIDeviceSet(pRHIDevice.get());
#ifdef __EMSCRIPTEN__
\tOldKOWebSyncRenderSurface(pRHIDevice.get(), true);
#endif
\tspdlog::info("render backend: {}", szBackendName);
'''
    text = replace_once(text, device_anchor, device_patch, "device sync")
    text = replace_once(
        text,
        "\t\tlocalInput.Tick();\n",
        "#ifdef __EMSCRIPTEN__\n\t\tOldKOWebSyncRenderSurface(pRHIDevice.get(), false);\n#endif\n\t\tlocalInput.Tick();\n",
        "frame sync",
    )
    text = replace_once(
        text,
        "\t\tSDL_Delay(g_bWindowInFocus ? 10 : 50);\n",
        "#ifdef __EMSCRIPTEN__\n\t\tOldKOWebPublishFrameTime();\n#endif\n\t\tSDL_Delay(g_bWindowInFocus ? 10 : 50);\n",
        "frame metrics",
    )
    return text


def patch_rhi(text: str) -> str:
    if RHI_MARKER in text:
        return text
    text = replace_once(
        text,
        '#include "RHIDeviceGL.h"\n',
        '#include "RHIDeviceGL.h"\n\n#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n#include <emscripten/html5.h>\n#endif\n',
        "rhi include",
    )
    texture_anchor = """\t*ppTexture = new RHITextureGL(width, height, levels, format);
\treturn D3D_OK;
"""
    texture_patch = """#ifdef __EMSCRIPTEN__
\tEM_ASM({
\t\tconst m = window.__OLDKO_RENDER_METRICS__ || {};
\t\tm.textureCreateCount = (m.textureCreateCount || 0) + 1;
\t\tm.maxTextureWidth = Math.max(m.maxTextureWidth || 0, $0);
\t\tm.maxTextureHeight = Math.max(m.maxTextureHeight || 0, $1);
\t\tm.maxMipLevels = Math.max(m.maxMipLevels || 0, $2);
\t\tif ($2 > 1) m.texturesWithMipmaps = (m.texturesWithMipmaps || 0) + 1;
\t\twindow.__OLDKO_RENDER_METRICS__ = m;
\t}, width, height, levels);
#endif
\t*ppTexture = new RHITextureGL(width, height, levels, format);
\treturn D3D_OK;
"""
    text = replace_once(text, texture_anchor, texture_patch, "rhi texture metrics")

    begin_anchor = '''bool RHIDeviceGL::BeginDraw(const gltr::FVFLayout& layout)
{
\tif (!m_bValid || !layout.valid)
\t\treturn false;

\tgl::UseProgram(m_uProgram);
'''
    begin_patch = '''bool RHIDeviceGL::BeginDraw(const gltr::FVFLayout& layout)
{
\tif (!m_bValid || !layout.valid)
\t\treturn false;

#ifdef __EMSCRIPTEN__
\t// P2-03 browser drawable metrics: canvas backing pixels are authoritative.
\t// Keep the D3D logical viewport separate so UI/picking remain in CSS pixels.
\tint canvasW = 0, canvasH = 0;
\temscripten_get_canvas_element_size("#canvas", &canvasW, &canvasH);
\tif (canvasW > 0 && canvasH > 0)
\t{
\t\tm_iWinPixelW = canvasW;
\t\tm_iWinPixelH = canvasH;
\t\tconst int logicalW = std::max(1, CN3Base::s_Options.iViewWidth);
\t\tm_fPixelDensity = static_cast<float>(canvasW) / static_cast<float>(logicalW);
\t\tCN3Base::s_fPixelDensity = m_fPixelDensity;
\t}
#endif

\tgl::UseProgram(m_uProgram);
'''
    return replace_once(text, begin_anchor, begin_patch, "rhi BeginDraw")


def main() -> None:
    for path in (MAIN, RHI):
        if not path.is_file():
            raise SystemExit(f"missing OpenKO source: {path}")
    main_text = MAIN.read_text(encoding="utf-8-sig")
    rhi_text = RHI.read_text(encoding="utf-8-sig")
    MAIN.write_text(patch_main(main_text), encoding="utf-8")
    RHI.write_text(patch_rhi(rhi_text), encoding="utf-8")
    print(f"P2-03 patched {MAIN}")
    print(f"P2-03 patched {RHI}")


if __name__ == "__main__":
    main()
