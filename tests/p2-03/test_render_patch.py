#!/usr/bin/env python3
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

PATCH = Path(__file__).resolve().parents[2] / "tools" / "p2_03_patch_openko_render.py"
spec = spec_from_file_location("p2_03_patch", PATCH)
mod = module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


def test_main_patch_removes_ws05_resolution_lock_and_preserves_logical_input_space():
    src = '''#include "StdAfx.h"\n#include <SDL3/SDL_main.h>\n\nnamespace\n{\nSDL_Window* g_pWindow      = nullptr;\nbool g_bWindowInFocus      = true;\nbool g_bQuitRequested      = false;\n}\nLoadGameOptions();\n#ifdef __EMSCRIPTEN__\nCN3Base::s_Options.iViewWidth    = 1024;\nCN3Base::s_Options.iViewHeight   = 768;\nCN3Base::s_Options.bWindowMode   = true;\nCN3Base::s_Options.bWindowCursor = false;\n#endif\n\tCN3Base::RHIDeviceSet(pRHIDevice.get());\n\tspdlog::info("render backend: {}", szBackendName);\n\t\tlocalInput.Tick();\n\t\tSDL_Delay(g_bWindowInFocus ? 10 : 50);\n'''
    out = mod.patch_main(src)
    assert "iViewWidth    = 1024" not in out
    assert "OldKOWebSyncRenderSurface(pRHIDevice.get(), true)" in out
    assert "OldKOWebSyncRenderSurface(pRHIDevice.get(), false)" in out
    assert "CN3Base::s_Options.iViewWidth = next.logicalW" in out
    assert "emscripten_set_canvas_element_size" in out
    assert "renderScale" in out
    assert "drawingBufferWidth" in out
    assert "frameTimeMs" in out and "wasmHeapBytes" in out
    assert mod.patch_main(out) == out


def test_rhi_patch_uses_canvas_backing_and_records_texture_mips():
    src = '''#include "RHIDeviceGL.h"\nHRESULT RHIDeviceGL::CreateTexture(UINT width, UINT height, UINT levels, DWORD, D3DFORMAT format, D3DPOOL, IRHITexture** ppTexture)\n{\n\t*ppTexture = new RHITextureGL(width, height, levels, format);\n\treturn D3D_OK;\n}\nbool RHIDeviceGL::BeginDraw(const gltr::FVFLayout& layout)\n{\n\tif (!m_bValid || !layout.valid)\n\t\treturn false;\n\n\tgl::UseProgram(m_uProgram);\n}\n'''
    out = mod.patch_rhi(src)
    assert "emscripten_get_canvas_element_size" in out
    assert "m_iWinPixelW = canvasW" in out
    assert "m_fPixelDensity" in out
    assert "textureCreateCount" in out
    assert "maxMipLevels" in out
    assert "texturesWithMipmaps" in out
    assert mod.patch_rhi(out) == out


def test_quality_policy_never_hides_sub_native_render_scale():
    text = PATCH.read_text(encoding="utf-8")
    assert 'return 2100000.0' in text
    assert 'return 4700000.0' in text
    assert 'return 8300000.0' in text
    assert 'std::max(1.0f, std::min(requested, budgetScale))' in text
    assert 'std::min(out.dpr, 2.0f)' in text
