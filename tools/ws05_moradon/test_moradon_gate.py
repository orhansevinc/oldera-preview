#!/usr/bin/env python3
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gate", ROOT / "moradon_gate.py")
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def good(self):
        return "\n".join([
            "WS04_CHAR_SELECT_RESPONSE success=1",
            "WS05_GATE event=moradon-zone-begin zone=21 terrain='Zones\\\\21.gtd' colormap='Zones\\\\21.tct' objects='Zones\\\\21.opd'",
            "WS05_GATE event=moradon-assets-loaded zone=21",
            "WS05_GATE event=moradon-terrain-rendered zone=21",
            "WS05_GATE event=moradon-shapes-rendered zone=21",
            "WS05_GATE event=moradon-local-player-rendered zone=21",
            "WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=0.42",
        ])

    def test_pass_requires_all_native_markers(self):
        self.assertEqual(gate.validate(self.good()), [])

    def test_missing_player_render_fails(self):
        errs = gate.validate(self.good().replace("WS05_GATE event=moradon-local-player-rendered zone=21\n", ""))
        self.assertTrue(any("local-player-rendered" in e for e in errs))

    def test_null_renderer_fails(self):
        errs = gate.validate(self.good() + "\nrender backend: Null\n")
        self.assertTrue(any("Null" in e for e in errs))

    def test_wrong_zone_does_not_pass(self):
        errs = gate.validate(self.good().replace("zone=21", "zone=1"))
        self.assertTrue(errs)


if __name__ == "__main__":
    unittest.main()
