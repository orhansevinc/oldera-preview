#!/usr/bin/env python3
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"RUNTIME_SOURCE_FAIL: {message}")


rhi_path = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
if not rhi_path.is_file():
    fail(f"missing {rhi_path}")

text = rhi_path.read_text(encoding="utf-8")
marker = "OldKOWeb live browser framebuffer refresh"
marker_pos = text.find(marker)
if marker_pos < 0:
    fail("live browser framebuffer refresh marker is missing")

block_start = text.rfind("#ifdef __EMSCRIPTEN__", 0, marker_pos)
block_end = text.find("#endif", marker_pos)
if block_start < 0 or block_end < 0:
    fail("cannot isolate live browser framebuffer refresh block")

block_end += len("#endif")
block = text[block_start:block_end]

# prepare_browser_source.py historically used a raw Python triple-quoted
# string for this generated C++ block. Normalize only this isolated block so
# literal backslash-t indentation cannot reach Clang, while preserving every
# other escape sequence and source file byte outside the WS01 patch.
if "\\t" in block:
    normalized = block.replace("\\t", "\t")
    text = text[:block_start] + normalized + text[block_end:]
    rhi_path.write_text(text, encoding="utf-8")
    block = normalized

if "\\t" in block:
    fail("literal backslash-t remains in generated framebuffer refresh block")
if "\t// OldKOWeb live browser framebuffer refresh" not in block:
    fail("normalized framebuffer refresh block lost its expected indentation")

# WS43's true-widescreen contract defines the selected browser size as the
# native logical AND backing-store resolution. A CSS viewport of 1920x1080 at
# DPR=2 must therefore stay a 1920x1080 Emscripten canvas/default framebuffer;
# DPR must not silently turn it into 3840x2160. Keep native desktop HiDPI
# behavior unchanged and disable SDL high-pixel-density window creation only
# for the Emscripten build.
main_path = Path("openko/src/Client/WarFare/WarFareMainSDL.cpp")
if not main_path.is_file():
    fail(f"missing {main_path}")

main_text = main_path.read_text(encoding="utf-8")
dpr_marker = "OldKOWeb browser native backing is DPR-independent"
if dpr_marker not in main_text:
    anchor = "\tSDL_WindowFlags windowFlags = SDL_WINDOW_HIGH_PIXEL_DENSITY;"
    if anchor not in main_text:
        fail("SDL high-pixel-density window flag anchor changed")
    replacement = '''#ifdef __EMSCRIPTEN__
\t// OldKOWeb browser native backing is DPR-independent: the selected
\t// viewport-native size is the actual SDL logical size AND canvas/default
\t// framebuffer size. Browser devicePixelRatio must not multiply it.
\tSDL_WindowFlags windowFlags = 0;
#else
\tSDL_WindowFlags windowFlags = SDL_WINDOW_HIGH_PIXEL_DENSITY;
#endif'''
    main_text = main_text.replace(anchor, replacement, 1)
    main_path.write_text(main_text, encoding="utf-8")

if dpr_marker not in main_text:
    fail("browser DPR-independent backing-store guard is missing")
if "#else\n\tSDL_WindowFlags windowFlags = SDL_WINDOW_HIGH_PIXEL_DENSITY;\n#endif" not in main_text:
    fail("native desktop high-pixel-density behavior was not preserved")

print("RUNTIME_SOURCE_NORMALIZED generated browser resize source + DPR-independent native backing are valid")
