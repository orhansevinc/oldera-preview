#!/usr/bin/env python3
"""Apply P2-10 browser input lifecycle fixes to the pinned OpenKO source.

This intentionally patches the native C++/SDL client. It does not add DOM UI,
server authority, renderer coordinate math, or publish a browser binary.
P2-00 must apply this after checking out the pinned engine source and rebuild
JS/WASM/data together.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess

ENGINE_COMMIT = "97eb0ea20207afc0c360bfed6915113572711be3"
TARGET = Path("src/Client/WarFare/WarFareMainSDL.cpp")
MARKER = "P2-10 browser input lifecycle"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one upstream anchor, found {count}")
    return text.replace(old, new, 1)


def require_source_pin(root: Path) -> None:
    try:
        head = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"cannot verify OpenKO source pin: {exc}") from exc
    if head != ENGINE_COMMIT:
        raise SystemExit(
            f"wrong OpenKO source commit: expected {ENGINE_COMMIT}, got {head}"
        )


def patch_text(source: str) -> str:
    if MARKER in source:
        return source

    focus_gained_old = '''\t\tcase SDL_EVENT_WINDOW_FOCUS_GAINED:\n\t\t\tspdlog::info("window focus gained");\n\t\t\tg_bWindowInFocus = true;\n\t\t\t// TODO(F6+): CGameProcedure::s_bIsWindowInFocus = true; refocus edit control\n\t\t\tbreak;'''
    focus_gained_new = '''\t\tcase SDL_EVENT_WINDOW_FOCUS_GAINED:\n\t\t\tspdlog::info("window focus gained");\n\t\t\tg_bWindowInFocus = true;\n\t\t\t// P2-10 browser input lifecycle: restore the engine focus bit and\n\t\t\t// keyboard acquisition. Do not synthesize any gameplay action here.\n\t\t\tCGameProcedure::s_bIsWindowInFocus = true;\n\t\t\tif (CGameProcedure::s_pLocalInput != nullptr)\n\t\t\t\tCGameProcedure::s_pLocalInput->SetActiveDevices(TRUE);\n\t\t\tbreak;'''
    source = replace_once(source, focus_gained_old, focus_gained_new, "focus gained")

    focus_lost_old = '''\t\tcase SDL_EVENT_WINDOW_FOCUS_LOST:\n\t\t\tspdlog::info("window focus lost");\n\t\t\tg_bWindowInFocus = false;\n\t\t\t// TODO(F6+): in fullscreen this exits like WA_INACTIVE did\n\t\t\tbreak;'''
    focus_lost_new = '''\t\tcase SDL_EVENT_WINDOW_FOCUS_LOST:\n\t\t\tspdlog::info("window focus lost");\n\t\t\tg_bWindowInFocus = false;\n\t\t\t// P2-10 browser input lifecycle: a browser can miss key-up/mouse-up\n\t\t\t// while another tab/window owns focus. Clear held state so W/A/S/D,\n\t\t\t// turn and mouse buttons cannot remain latched on re-entry.\n\t\t\tCGameProcedure::s_bIsWindowInFocus = false;\n\t\t\tif (CGameProcedure::s_pLocalInput != nullptr)\n\t\t\t{\n\t\t\t\tCGameProcedure::s_pLocalInput->SetActiveDevices(FALSE);\n\t\t\t\tCGameProcedure::s_pLocalInput->KeyboardClearInput();\n\t\t\t\tCGameProcedure::s_pLocalInput->MouseRemoveFlag();\n\t\t\t}\n\t\t\tbreak;'''
    source = replace_once(source, focus_lost_old, focus_lost_new, "focus lost")

    key_old = '''\t\tcase SDL_EVENT_KEY_DOWN:\n\t\t\tif (CN3UIEdit::TextInputActive())\n\t\t\t\tCN3UIEdit::OnKeyDown(SdlScancodeToDik(event.key.scancode));\n\t\t\tbreak;'''
    key_new = '''\t\tcase SDL_EVENT_KEY_DOWN:\n\t\t\t// P2-10 browser input lifecycle: fullscreen is requested only from\n\t\t\t// the physical ALT+ENTER user gesture. This keeps browser policy\n\t\t\t// compliance and does not alter the game's mouse/camera equations.\n\t\t\tif ((event.key.mod & SDL_KMOD_ALT) != 0\n\t\t\t\t&& event.key.scancode == SDL_SCANCODE_RETURN\n\t\t\t\t&& g_pWindow != nullptr)\n\t\t\t{\n\t\t\t\tconst bool isFullscreen =\n\t\t\t\t\t(SDL_GetWindowFlags(g_pWindow) & SDL_WINDOW_FULLSCREEN) != 0;\n\t\t\t\tif (!SDL_SetWindowFullscreen(g_pWindow, !isFullscreen))\n\t\t\t\t\tspdlog::warn("fullscreen toggle failed: {}", SDL_GetError());\n\t\t\t\tbreak;\n\t\t\t}\n\n\t\t\tif (CN3UIEdit::TextInputActive())\n\t\t\t\tCN3UIEdit::OnKeyDown(SdlScancodeToDik(event.key.scancode));\n\t\t\tbreak;'''
    source = replace_once(source, key_old, key_new, "ALT+ENTER")
    return source


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path, help="pinned old-school-openko checkout")
    parser.add_argument("--check", action="store_true", help="validate patchability without writing")
    args = parser.parse_args()

    root = args.source_root.resolve()
    require_source_pin(root)
    target = root / TARGET
    if not target.is_file():
        raise SystemExit(f"missing pinned native client source: {target}")

    original = target.read_text(encoding="utf-8-sig")
    patched = patch_text(original)
    if args.check:
        if MARKER not in patched:
            raise SystemExit("P2-10 marker missing after dry-run patch")
        print(f"PASS: {TARGET} is patchable at {ENGINE_COMMIT}")
        return 0

    target.write_text(patched, encoding="utf-8")
    print(f"patched {TARGET}; P2-00 must rebuild JS/WASM/data from this source")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
