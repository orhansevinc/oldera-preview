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
