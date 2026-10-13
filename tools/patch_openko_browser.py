#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label}: upstream anchor changed")
    return text.replace(old, new, 1)


# OpenAL: Emscripten provides a browser OpenAL shim.
p = Path("openko/cmake/FindOpenALSoft.cmake")
s = p.read_text()
browser = '''if(EMSCRIPTEN)\n  add_library(OpenAL INTERFACE)\n  target_link_libraries(OpenAL INTERFACE "-lopenal")\n  set(openalsoft_FOUND TRUE)\n  return()\nendif()\n\n'''
if not s.startswith("if(EMSCRIPTEN)"):
    p.write_text(browser + s)

p = Path("openko/src/N3Base/N3SndMgr.h")
s = p.read_text(encoding="utf-8-sig")
old = "struct ALCcontext;\nstruct ALCdevice;"
new = "#ifdef __EMSCRIPTEN__\n#include <AL/alc.h>\n#else\nstruct ALCcontext;\nstruct ALCdevice;\n#endif"
if old in s:
    p.write_text(s.replace(old, new), encoding="utf-8")
elif "#include <AL/alc.h>" not in s:
    raise SystemExit("N3SndMgr.h: OpenAL declarations changed upstream")

# The first browser milestone is a single-threaded build. OpenAL itself has
# an Emscripten shim, but OpenKO's AudioThread starts std::thread (and then a
# decoder thread), which throws before the login scene is constructed. Use
# the engine's existing sound-unavailable path until a browser audio pump is
# implemented. Do not pretend audio is working or alter native audio builds.
p = Path("openko/src/N3Base/N3SndMgr.cpp")
s = p.read_text(encoding="utf-8-sig")
audio_anchor = "bool CN3SndMgr::InitOpenAL()\n{\n"
audio_browser = '''bool CN3SndMgr::InitOpenAL()
{
#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)
\tCLogWriter::Write("browser audio unavailable: native audio workers require pthreads; login continues without sound");
\treturn false;
#else
'''
if "browser audio unavailable: native audio workers require pthreads" not in s:
    s = replace_once(s, audio_anchor, audio_browser, "single-thread browser audio")
    audio_tail = "\t_thread->start();\n\treturn true;\n}"
    s = replace_once(s, audio_tail, "\t_thread->start();\n\treturn true;\n#endif\n}", "browser audio guard end")
p.write_text(s, encoding="utf-8")

# Keep jpeg static in the WASM executable.
p = Path("openko/cmake/FindJpeg.cmake")
s = p.read_text()
s = s.replace(
    "if(WIN32)\n  set(LIBJPEG_BUILD_SHARED_LIBS OFF",
    "if(WIN32 OR EMSCRIPTEN)\n  set(LIBJPEG_BUILD_SHARED_LIBS OFF",
)
s = s.replace(
    "if(WIN32)\n  target_link_libraries(libjpeg INTERFACE jpeg_static)",
    "if(WIN32 OR EMSCRIPTEN)\n  target_link_libraries(libjpeg INTERFACE jpeg_static)",
)
p.write_text(s)

# ---------------------------------------------------------------------------
# Browser GL adapter.
# The POSIX port already contains the actual RHIDeviceGL. Desktop GL symbol
# probing fails in WebGL2 because several desktop-only APIs do not exist.
# Under Emscripten bind GLES3 entry points directly and use compatibility
# shims only where WebGL2 differs.
# ---------------------------------------------------------------------------
p = Path("openko/src/Client/WarFare/GLLoader.cpp")
s = p.read_text()
if "#include <GLES3/gl3.h>" not in s:
    s = replace_once(
        s,
        '#include "GLLoader.h"\n',
        '#include "GLLoader.h"\n\n#ifdef __EMSCRIPTEN__\n#include <GLES3/gl3.h>\n#endif\n',
        "GLLoader include",
    )

load_anchor = '''bool Load(ProcLoader loader)\n{\n\tif (loader == nullptr)\n\t\treturn false;\n'''
browser_load = '''bool Load(ProcLoader loader)\n{\n#ifdef __EMSCRIPTEN__\n\t(void) loader;\n\n#define OPENKO_WEBGL_BIND(Name, Symbol) \\\n\tName = reinterpret_cast<decltype(Name)>(&::Symbol)\n\tOPENKO_WEBGL_BIND(ClearColor, glClearColor);\n\tClearDepth = +[](Clampd depth) { ::glClearDepthf(static_cast<GLfloat>(depth)); };\n\tOPENKO_WEBGL_BIND(Clear, glClear);\n\tOPENKO_WEBGL_BIND(Viewport, glViewport);\n\tDepthRange = +[](Clampd zNear, Clampd zFar) {\n\t\t::glDepthRangef(static_cast<GLfloat>(zNear), static_cast<GLfloat>(zFar));\n\t};\n\tOPENKO_WEBGL_BIND(Scissor, glScissor);\n\tOPENKO_WEBGL_BIND(Enable, glEnable);\n\tOPENKO_WEBGL_BIND(Disable, glDisable);\n\tOPENKO_WEBGL_BIND(GetError, glGetError);\n\tOPENKO_WEBGL_BIND(GetString, glGetString);\n\tOPENKO_WEBGL_BIND(GetStringi, glGetStringi);\n\tOPENKO_WEBGL_BIND(GetIntegerv, glGetIntegerv);\n\tOPENKO_WEBGL_BIND(PixelStorei, glPixelStorei);\n\tOPENKO_WEBGL_BIND(ReadPixels, glReadPixels);\n\n\tOPENKO_WEBGL_BIND(BlendFunc, glBlendFunc);\n\tOPENKO_WEBGL_BIND(DepthFunc, glDepthFunc);\n\tOPENKO_WEBGL_BIND(DepthMask, glDepthMask);\n\tOPENKO_WEBGL_BIND(CullFace, glCullFace);\n\tOPENKO_WEBGL_BIND(FrontFace, glFrontFace);\n\tPolygonMode = +[](Enum, Enum) {};\n\n\tOPENKO_WEBGL_BIND(GenBuffers, glGenBuffers);\n\tOPENKO_WEBGL_BIND(DeleteBuffers, glDeleteBuffers);\n\tOPENKO_WEBGL_BIND(BindBuffer, glBindBuffer);\n\tOPENKO_WEBGL_BIND(BufferData, glBufferData);\n\tOPENKO_WEBGL_BIND(BufferSubData, glBufferSubData);\n\tOPENKO_WEBGL_BIND(GenVertexArrays, glGenVertexArrays);\n\tOPENKO_WEBGL_BIND(DeleteVertexArrays, glDeleteVertexArrays);\n\tOPENKO_WEBGL_BIND(BindVertexArray, glBindVertexArray);\n\tOPENKO_WEBGL_BIND(VertexAttribPointer, glVertexAttribPointer);\n\tOPENKO_WEBGL_BIND(EnableVertexAttribArray, glEnableVertexAttribArray);\n\tOPENKO_WEBGL_BIND(DisableVertexAttribArray, glDisableVertexAttribArray);\n\n\tOPENKO_WEBGL_BIND(GenTextures, glGenTextures);\n\tOPENKO_WEBGL_BIND(DeleteTextures, glDeleteTextures);\n\tOPENKO_WEBGL_BIND(BindTexture, glBindTexture);\n\tOPENKO_WEBGL_BIND(ActiveTexture, glActiveTexture);\n\tOPENKO_WEBGL_BIND(TexImage2D, glTexImage2D);\n\tOPENKO_WEBGL_BIND(CompressedTexImage2D, glCompressedTexImage2D);\n\tOPENKO_WEBGL_BIND(TexParameteri, glTexParameteri);\n\tOPENKO_WEBGL_BIND(GenSamplers, glGenSamplers);\n\tOPENKO_WEBGL_BIND(DeleteSamplers, glDeleteSamplers);\n\tOPENKO_WEBGL_BIND(BindSampler, glBindSampler);\n\tOPENKO_WEBGL_BIND(SamplerParameteri, glSamplerParameteri);\n\tOPENKO_WEBGL_BIND(SamplerParameterfv, glSamplerParameterfv);\n\n\tOPENKO_WEBGL_BIND(CreateShader, glCreateShader);\n\tOPENKO_WEBGL_BIND(ShaderSource, glShaderSource);\n\tOPENKO_WEBGL_BIND(CompileShader, glCompileShader);\n\tOPENKO_WEBGL_BIND(GetShaderiv, glGetShaderiv);\n\tOPENKO_WEBGL_BIND(GetShaderInfoLog, glGetShaderInfoLog);\n\tOPENKO_WEBGL_BIND(DeleteShader, glDeleteShader);\n\tOPENKO_WEBGL_BIND(CreateProgram, glCreateProgram);\n\tOPENKO_WEBGL_BIND(AttachShader, glAttachShader);\n\tOPENKO_WEBGL_BIND(LinkProgram, glLinkProgram);\n\tOPENKO_WEBGL_BIND(GetProgramiv, glGetProgramiv);\n\tOPENKO_WEBGL_BIND(GetProgramInfoLog, glGetProgramInfoLog);\n\tOPENKO_WEBGL_BIND(UseProgram, glUseProgram);\n\tOPENKO_WEBGL_BIND(DeleteProgram, glDeleteProgram);\n\tOPENKO_WEBGL_BIND(GetUniformLocation, glGetUniformLocation);\n\tOPENKO_WEBGL_BIND(Uniform1i, glUniform1i);\n\tOPENKO_WEBGL_BIND(Uniform1iv, glUniform1iv);\n\tOPENKO_WEBGL_BIND(Uniform1f, glUniform1f);\n\tOPENKO_WEBGL_BIND(Uniform2f, glUniform2f);\n\tOPENKO_WEBGL_BIND(Uniform3fv, glUniform3fv);\n\tOPENKO_WEBGL_BIND(Uniform4fv, glUniform4fv);\n\tOPENKO_WEBGL_BIND(UniformMatrix4fv, glUniformMatrix4fv);\n\n\tOPENKO_WEBGL_BIND(DrawArrays, glDrawArrays);\n\tOPENKO_WEBGL_BIND(DrawElements, glDrawElements);\n\t// TODO(world milestone): emulate non-zero baseVertex by adjusting the\n\t// vertex-buffer offset. Login/UI and the RHI validation slice use zero.\n\tDrawElementsBaseVertex = +[](Enum mode, Sizei count, Enum type, const void* indices, Int) {\n\t\t::glDrawElements(static_cast<GLenum>(mode), static_cast<GLsizei>(count),\n\t\t\tstatic_cast<GLenum>(type), indices);\n\t};\n\n\tOPENKO_WEBGL_BIND(GenFramebuffers, glGenFramebuffers);\n\tOPENKO_WEBGL_BIND(DeleteFramebuffers, glDeleteFramebuffers);\n\tOPENKO_WEBGL_BIND(BindFramebuffer, glBindFramebuffer);\n\tOPENKO_WEBGL_BIND(FramebufferTexture2D, glFramebufferTexture2D);\n\tOPENKO_WEBGL_BIND(CheckFramebufferStatus, glCheckFramebufferStatus);\n\tOPENKO_WEBGL_BIND(GenRenderbuffers, glGenRenderbuffers);\n\tOPENKO_WEBGL_BIND(DeleteRenderbuffers, glDeleteRenderbuffers);\n\tOPENKO_WEBGL_BIND(BindRenderbuffer, glBindRenderbuffer);\n\tOPENKO_WEBGL_BIND(RenderbufferStorage, glRenderbufferStorage);\n\tOPENKO_WEBGL_BIND(FramebufferRenderbuffer, glFramebufferRenderbuffer);\n#undef OPENKO_WEBGL_BIND\n\treturn true;\n#else\n\tif (loader == nullptr)\n\t\treturn false;\n'''
if "#ifdef __EMSCRIPTEN__\n\t(void) loader;" not in s:
    s = replace_once(s, load_anchor, browser_load, "GLLoader Load")
    tail = "\treturn ok;\n}\n\n} // namespace gl"
    s = replace_once(s, tail, "\treturn ok;\n#endif\n}\n\n} // namespace gl", "GLLoader tail")
p.write_text(s)

# WebGL2 shader language is GLSL ES 300, not desktop GLSL 330. Also request
# a GLES 3.0 context explicitly in browsers instead of the desktop 3.3-core
# profile used by Linux/macOS. Emscripten maps GLES3 to WebGL2.
p = Path("openko/src/Client/WarFare/RHIDeviceGL.cpp")
s = p.read_text()
if "#version 330 core" in s:
    if s.count("#version 330 core") < 2:
        raise SystemExit("RHIDeviceGL shader anchors changed upstream")
    s = s.replace("#version 330 core", "#version 300 es\\nprecision highp float;")

context_attrs = '''\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);'''
context_attrs_web = '''#ifdef __EMSCRIPTEN__\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, 0);\n#else\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);\n\tSDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);\n#endif'''
if "SDL_GL_CONTEXT_PROFILE_ES" not in s:
    s = replace_once(s, context_attrs, context_attrs_web, "RHIDeviceGL WebGL2 context")

# Desktop GL accepts BGRA vertex attributes and texture uploads; WebGL2
# accepts neither. Keep D3D data unchanged and convert at the RHI boundary.
if "OldERA WebGL2 pixel conversion" not in s:
    texture_anchor = "\t\telse\n\t\t{\n\t\t\tgl::TexImage2D(gl::TEXTURE_2D, static_cast<gl::Int>(i),"
    texture_browser = '''\t\telse
\t\t{
#ifdef __EMSCRIPTEN__
\t\t\t// OldERA WebGL2 pixel conversion: preserve row pitch and alpha.
\t\t\tstd::vector<uint8_t> rgba(static_cast<size_t>(level.width) * level.height * 4);
\t\t\tfor (UINT y = 0; y < level.height; ++y)
\t\t\t{
\t\t\t\tconst uint8_t* row = level.storage.data() + static_cast<size_t>(y) * level.pitch;
\t\t\t\tfor (UINT x = 0; x < level.width; ++x)
\t\t\t\t{
\t\t\t\t\tuint8_t* dst = rgba.data() + (static_cast<size_t>(y) * level.width + x) * 4;
\t\t\t\t\tif (m_eFormat == D3DFMT_A8R8G8B8 || m_eFormat == D3DFMT_X8R8G8B8)
\t\t\t\t\t{
\t\t\t\t\t\tconst uint8_t* src = row + x * 4;
\t\t\t\t\t\tdst[0] = src[2]; dst[1] = src[1]; dst[2] = src[0];
\t\t\t\t\t\tdst[3] = m_eFormat == D3DFMT_X8R8G8B8 ? 255 : src[3];
\t\t\t\t\t}
\t\t\t\t\telse if (m_eFormat == D3DFMT_R8G8B8)
\t\t\t\t\t{
\t\t\t\t\t\tconst uint8_t* src = row + x * 3;
\t\t\t\t\t\tdst[0] = src[2]; dst[1] = src[1]; dst[2] = src[0]; dst[3] = 255;
\t\t\t\t\t}
\t\t\t\t\telse
\t\t\t\t\t{
\t\t\t\t\t\tconst uint16_t v = static_cast<uint16_t>(row[x * 2])
\t\t\t\t\t\t\t| (static_cast<uint16_t>(row[x * 2 + 1]) << 8);
\t\t\t\t\t\tif (m_eFormat == D3DFMT_A1R5G5B5)
\t\t\t\t\t\t{
\t\t\t\t\t\t\tconst auto expand = [](uint16_t c) { return static_cast<uint8_t>((c << 3) | (c >> 2)); };
\t\t\t\t\t\t\tdst[0] = expand((v >> 10) & 31); dst[1] = expand((v >> 5) & 31);
\t\t\t\t\t\t\tdst[2] = expand(v & 31); dst[3] = (v & 0x8000) ? 255 : 0;
\t\t\t\t\t\t}
\t\t\t\t\t\telse // D3DFMT_A4R4G4B4; all other formats are rejected above.
\t\t\t\t\t\t{
\t\t\t\t\t\t\tdst[0] = ((v >> 8) & 15) * 17; dst[1] = ((v >> 4) & 15) * 17;
\t\t\t\t\t\t\tdst[2] = (v & 15) * 17; dst[3] = ((v >> 12) & 15) * 17;
\t\t\t\t\t\t}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t\tgl::TexImage2D(gl::TEXTURE_2D, static_cast<gl::Int>(i), gl::RGBA8,
\t\t\t\tstatic_cast<gl::Sizei>(level.width), static_cast<gl::Sizei>(level.height),
\t\t\t\t0, gl::RGBA, gl::UNSIGNED_BYTE, rgba.data());
#else
\t\t\tgl::TexImage2D(gl::TEXTURE_2D, static_cast<gl::Int>(i),'''
    s = replace_once(s, texture_anchor, texture_browser, "WebGL2 texture upload")
    s = replace_once(s, "\t\t\t\tlevel.storage.data());\n\t\t}\n", "\t\t\t\tlevel.storage.data());\n#endif\n\t\t}\n", "WebGL2 texture upload end")
    color_anchor = "\t\tgl::VertexAttribPointer(2, static_cast<gl::Int>(gl::BGRA), gl::UNSIGNED_BYTE, 1,\n\t\t\tlayout.stride, Offset(layout.colorOffset));"
    s = replace_once(s, color_anchor, '''#ifdef __EMSCRIPTEN__
\t\tgl::VertexAttribPointer(2, 4, gl::UNSIGNED_BYTE, 1,
\t\t\tlayout.stride, Offset(layout.colorOffset));
#else
''' + color_anchor + "\n#endif", "WebGL2 vertex color")
    base = "\tvec4 base = (uHasColor != 0) ? aColor : vec4(1.0);"
    s = replace_once(s, base, "#ifdef GL_ES\n\tvec4 base = (uHasColor != 0) ? aColor.bgra : vec4(1.0);\n#else\n" + base + "\n#endif", "WebGL2 vertex swizzle")
    border = "\t\tgl::SamplerParameterfv(sampler, gl::TEXTURE_BORDER_COLOR, borderRgba);"
    s = replace_once(s, border, "#ifndef __EMSCRIPTEN__\n" + border + "\n#endif", "WebGL2 sampler border")
p.write_text(s)

# Fixed KO logical viewport. CSS does presentation scaling only.
p = Path("openko/src/Client/WarFare/WarFareMainSDL.cpp")
s = p.read_text()
if "CN3Base::s_Options.iViewWidth  = 1024" not in s:
    anchor = "\tLoadGameOptions();\n\n\t__Options::PosixRenderer eRenderer"
    repl = '''\tLoadGameOptions();\n\n#ifdef __EMSCRIPTEN__\n\tCN3Base::s_Options.iViewWidth    = 1024;\n\tCN3Base::s_Options.iViewHeight   = 768;\n\tCN3Base::s_Options.bWindowMode   = true;\n\tCN3Base::s_Options.bWindowCursor = false;\n#endif\n\n\t__Options::PosixRenderer eRenderer'''
    s = replace_once(s, anchor, repl, "WarFareMainSDL options")
p.write_text(s)

# The real 1298 login procedure immediately opens a raw TCP socket from
# Server.ini during Init(). Browsers cannot make raw TCP connections. Until
# the WebSocket<->TCP gateway is attached, keep the genuine login scene alive
# instead of letting the failed 127.0.0.1 connection post BEHAVIOR_EXIT.
p = Path("openko/src/Client/WarFare/GameProcLogIn_1298.cpp")
s = p.read_text(encoding="utf-8-sig")
connect_anchor = '''\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)\n\t{'''
connect_browser = '''#ifdef __EMSCRIPTEN__\n\t(void) iServer;\n\tm_pUILogIn->FocusToID();\n\tspdlog::info("browser login scene ready; network deferred to WebSocket gateway");\n#else\n\tif (iServer >= 0 && lstrlen(szIPs[iServer]) > 0)\n\t{'''
if "browser login scene ready; network deferred to WebSocket gateway" not in s:
    s = replace_once(s, connect_anchor, connect_browser, "GameProcLogIn browser network begin")
    connect_tail = '''\telse\n\t{\n\t\tMessageBoxPost("No server list", "LogIn Server fail", MB_OK, BEHAVIOR_EXIT); // 끝낸다.\n\t}\n\n\t// 게임 계정으로 들어 왔으면..'''
    connect_tail_browser = '''\telse\n\t{\n\t\tMessageBoxPost("No server list", "LogIn Server fail", MB_OK, BEHAVIOR_EXIT); // 끝낸다.\n\t}\n#endif\n\n\t// 게임 계정으로 들어 왔으면..'''
    s = replace_once(s, connect_tail, connect_tail_browser, "GameProcLogIn browser network end")
p.write_text(s, encoding="utf-8")

# Browser linker settings + first genuine 1298 runtime asset slice.
p = Path("openko/src/Client/WarFare/CMakeLists.txt")
s = p.read_text()
s = s.replace(
    "if(UNIX AND NOT APPLE)\n    # Linux: a freedesktop menu entry",
    "if(UNIX AND NOT APPLE AND NOT EMSCRIPTEN)\n    # Linux: a freedesktop menu entry",
)

# CMake de-duplicates repeated linker options. A sequence such as
#   --preload-file path1 --preload-file path2
# therefore becomes
#   --preload-file path1 path2
# and Emscripten interprets path2 as a normal input object. Keep every
# preload pair inside its own SHELL: option so each mapping survives intact.
browser_block = '''\nif(EMSCRIPTEN)\n  set_target_properties(WarFare PROPERTIES SUFFIX ".html")\n  target_link_options(WarFare PRIVATE\n    "-sMIN_WEBGL_VERSION=2"\n    "-sMAX_WEBGL_VERSION=2"\n    "-sFULL_ES3=1"\n    "-sGL_ENABLE_GET_PROC_ADDRESS=1"\n    "-sALLOW_MEMORY_GROWTH=1"\n    "-sFORCE_FILESYSTEM=1"\n    "-sASYNCIFY"\n    "-sEXIT_RUNTIME=1"\n    "-sASSERTIONS=1"\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Data@/data/Data"\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/UI_US@/data/UI_US"\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Snd/Intro_Sound.mp3@/data/Snd/Intro_Sound.mp3"\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../ko-assets/Server.ini@/data/Server.ini")\nendif()\n'''
if 'if(EMSCRIPTEN)\n  set_target_properties(WarFare PROPERTIES SUFFIX ".html")' not in s:
    s += browser_block
else:
    start = s.index('if(EMSCRIPTEN)\n  set_target_properties(WarFare PROPERTIES SUFFIX ".html")')
    end = s.index('\nendif()', start) + len('\nendif()')
    s = s[:start] + browser_block.strip("\n") + s[end:]
p.write_text(s)

print("OldERA browser patches applied: WebGL2 ES3 + 1024x768 + genuine 1298 login assets")
