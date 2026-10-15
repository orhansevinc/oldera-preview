#!/usr/bin/env python3
"""P2-10 source gate for the integrated OpenKO checkout.

Exit 0 means the source-side P2-10 invariants are present. It is deliberately
not a replacement for the real-browser smoke run or P2-00 bundle provenance.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def require(text: str, token: str, label: str) -> None:
    if token not in text:
        raise SystemExit(f"BLOCKED: missing {label}: {token}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path)
    args = parser.parse_args()
    root = args.source_root.resolve()

    main_sdl = (root / "src/Client/WarFare/WarFareMainSDL.cpp").read_text(encoding="utf-8-sig")
    game_main = (root / "src/Client/WarFare/GameProcMain.cpp").read_text(encoding="utf-8-sig")
    snd_mgr = (root / "src/N3Base/N3SndMgr.cpp").read_text(encoding="utf-8-sig")

    require(main_sdl, "P2-10 browser input lifecycle", "focus lifecycle patch")
    require(main_sdl, "KeyboardClearInput()", "focus-loss keyboard clear")
    require(main_sdl, "MouseRemoveFlag()", "focus-loss mouse clear")
    require(main_sdl, "SDL_SetWindowFullscreen", "gesture fullscreen toggle")

    for token in (
        "CommandToggleUIInventory",
        "CommandToggleUIState",
        "CommandToggleUISkillTree",
        "CommandToggleUIMiniMap",
        "CommandToggleCmdList",
        "MsgRecv_MagicProcess",
        "MsgRecv_ItemRepair",
        "MsgRecv_ItemUpgrade",
        "MsgRecv_WareHouse",
        "MsgRecv_PartyOrForce",
        "MsgRecv_PerTrade",
    ):
        require(game_main, token, f"native client action {token}")

    # WS42's first browser milestone intentionally disabled sound on the
    # single-thread build. A P2-10 integration must not be called audio-ready
    # while that guard is still present. P2-00 may satisfy this via a proven
    # pthread-capable build or a separately reviewed synchronous audio pump.
    disabled_guard = "browser audio unavailable: native audio workers require pthreads"
    if disabled_guard in snd_mgr:
        raise SystemExit(
            "BLOCKED: browser audio is intentionally disabled by the WS42 single-thread guard; "
            "P2-00 must produce and prove an audio-capable rebuild"
        )

    require(game_main, "PlayBGM_Town", "native town BGM event")
    require(game_main, "PlayBGM_Battle", "native battle BGM event")
    require(game_main, "ReleaseSound", "native audio teardown")

    print("PASS: P2-10 native source invariants present; run real-browser smoke next")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
