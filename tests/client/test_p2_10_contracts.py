import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
P2 = ROOT / "coordination" / "phase2" / "P2-10"
PATCH = ROOT / "client-src" / "p2_10" / "apply_browser_input_lifecycle.py"


def load(name: str):
    return json.loads((P2 / name).read_text(encoding="utf-8"))


def test_required_native_controls_are_accounted_for():
    matrix = load("action-matrix.json")
    by_name = {entry["control"]: entry for entry in matrix["controls"]}
    required = {
        "Map / minimap",
        "Inventory / equipment",
        "Character state",
        "Skill tree",
        "Hotbar drag/drop and keys",
        "Command menu",
        "Exit",
        "NPC dialog",
        "NPC shop",
        "Inn / storage",
        "Quest",
        "Upgrade / repair",
        "Loot",
        "Player trade",
        "Invite / party",
        "Clan",
        "Chat / whisper",
        "Mouse/camera and world click isolation",
        "Focus loss / fullscreen",
    }
    assert required <= by_name.keys()
    assert all(by_name[name]["status"] in {"PASS", "FAIL", "BLOCKED"} for name in required)


def test_provider_dependent_controls_fail_closed():
    matrix = load("action-matrix.json")
    providers = ("P2-05", "P2-07", "P2-08", "P2-09")
    for entry in matrix["controls"]:
        text = json.dumps(entry, sort_keys=True)
        if any(provider in text for provider in providers):
            assert entry["status"] != "FAIL"
            if entry["status"] == "BLOCKED":
                assert entry.get("blocker")


def test_command_menu_is_not_gm_authority():
    matrix = load("action-matrix.json")
    command = next(e for e in matrix["controls"] if e["control"] == "Command menu")
    assert "never grants GM authority" in command["security_rule"]
    assert "AUTHORITY_MANAGER" in command["evidence"]


def test_no_dom_game_ui_or_fake_success_contract():
    deps = load("dependency-proposal.json")
    assert "never synthesizes success" in deps["fail_closed_policy"]
    matrix_text = (P2 / "action-matrix.json").read_text(encoding="utf-8").lower()
    assert "dom overlay" not in matrix_text
    assert "fake success" not in matrix_text


def test_focus_patch_clears_latched_input_and_preserves_native_ui():
    text = PATCH.read_text(encoding="utf-8")
    assert "KeyboardClearInput()" in text
    assert "MouseRemoveFlag()" in text
    assert "SetActiveDevices(FALSE)" in text
    assert "SetActiveDevices(TRUE)" in text
    assert "SDL_EVENT_WINDOW_FOCUS_LOST" in text
    assert "SDL_EVENT_WINDOW_FOCUS_GAINED" in text
    assert "SDL_SetWindowFullscreen" in text
    assert "SDL_KMOD_ALT" in text
    assert "SDL_SCANCODE_RETURN" in text


def test_audio_stays_native_and_browser_claim_is_fail_closed():
    audio = load("audio-event-map.json")
    assert "CN3SndMgr/CN3SndObj" in audio["policy"]
    assert audio["browser_runtime"]["status"] == "BLOCKED"
    names = {event["event"] for event in audio["events"]}
    assert {"town_music", "battle_music", "world_ambient", "footstep", "attack", "skill", "ui"} <= names
    assert "second browser audio graph" in audio["duplicate_prevention"]


def load_tests(loader, tests, pattern):
    suite = unittest.TestSuite()
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            suite.addTest(unittest.FunctionTestCase(value, description=name))
    return suite
