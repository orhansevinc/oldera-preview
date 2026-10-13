#!/usr/bin/env python3
from pathlib import Path


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"RUNTIME_SOURCE_FAIL: {message}")


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

cmake = Path("openko/src/Client/WarFare/CMakeLists.txt")
require(cmake.is_file(), f"missing {cmake}")
cmake_text = cmake.read_text(encoding="utf-8")
for marker in (
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

print("RUNTIME_SOURCE_OK WebGL2/GLES3 + filesystem preload anchors verified")
