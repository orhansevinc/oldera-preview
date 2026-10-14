#!/usr/bin/env python3
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"RUNTIME_SOURCE_FAIL: {message}")


path = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
if not path.is_file():
    fail(f"missing {path}")

text = path.read_text(encoding="utf-8")
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
    path.write_text(text, encoding="utf-8")
    block = normalized

if "\\t" in block:
    fail("literal backslash-t remains in generated framebuffer refresh block")
if "\t// OldKOWeb live browser framebuffer refresh" not in block:
    fail("normalized framebuffer refresh block lost its expected indentation")

print("RUNTIME_SOURCE_NORMALIZED generated RHIDeviceGL browser-resize block is valid C++ indentation")
