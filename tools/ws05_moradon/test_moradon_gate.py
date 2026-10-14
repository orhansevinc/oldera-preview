#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("gate", ROOT / "moradon_gate.py")
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
patch_spec = importlib.util.spec_from_file_location("patch", ROOT / "patch_moradon_client.py")
patch = importlib.util.module_from_spec(patch_spec); patch_spec.loader.exec_module(patch)


class GateTests(unittest.TestCase):
    def good(self):
        return "\n".join([
            "WS04_CHAR_SELECT_RESPONSE success=1",
            "WS05_GATE event=moradon-zone-begin zone=21 native_zone=210 terrain='Zones\\\\Moradon_xmas.gtd' colormap='Zones\\\\moradon.tct' objects='Zones\\\\moradon.opd'",
            "WS05_GATE event=moradon-assets-loaded zone=21 native_zone=210",
            "WS05_GATE event=moradon-terrain-rendered zone=21 native_zone=210",
            "WS05_GATE event=moradon-shapes-rendered zone=21 native_zone=210",
            "WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210",
            "WS05_MORADON_VISUAL_OK source=pre-swap-gl ratio=0.42",
        ])

    def test_pass_requires_wire_and_native_zone_markers(self):
        self.assertEqual(gate.validate(self.good()), [])

    def test_missing_player_render_fails(self):
        errs = gate.validate(self.good().replace("WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210\n", ""))
        self.assertTrue(any("local-player-rendered" in e for e in errs))

    def test_null_renderer_fails(self):
        errs = gate.validate(self.good() + "\nrender backend: Null\n")
        self.assertTrue(any("Null" in e for e in errs))

    def test_wire_zone_without_native_zone_does_not_pass(self):
        errs = gate.validate(self.good().replace(" native_zone=210", ""))
        self.assertTrue(errs)

    def test_wrong_native_zone_does_not_pass(self):
        errs = gate.validate(self.good().replace("native_zone=210", "native_zone=21"))
        self.assertTrue(errs)

    def test_wrong_wire_zone_does_not_pass(self):
        errs = gate.validate(self.good().replace("zone=21", "zone=1"))
        self.assertTrue(errs)


class InstrumentationContractTests(unittest.TestCase):
    def test_wire_and_native_zone_namespaces_are_distinct(self):
        self.assertEqual(patch.MORADON_WIRE_ZONE_ID, 21)
        self.assertEqual(patch.MORADON_NATIVE_ZONE_ID, 210)

    def test_native_probes_compare_against_210(self):
        source = (ROOT / "patch_moradon_client.py").read_text(encoding="utf-8")
        self.assertGreaterEqual(source.count("iZoneID == 210"), 2)
        self.assertGreaterEqual(source.count("m_InfoExt.iZoneCur == 210"), 3)
        self.assertNotIn("iZoneID == 21)", source)
        self.assertNotIn("m_InfoExt.iZoneCur == 21)", source)


if __name__ == "__main__":
    unittest.main()
