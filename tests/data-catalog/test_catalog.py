import copy
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "ws31_data" / "validate_catalog.py"
spec = importlib.util.spec_from_file_location("ws31_validate_catalog", MODULE_PATH)
validator = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(validator)

class CatalogValidationTests(unittest.TestCase):
    def setUp(self):
        self.catalogs = validator.load_catalog(ROOT)

    def test_catalog_json_schema_validation(self):
        self.assertEqual([], validator.validate_json_schema(ROOT, self.catalogs))

    def test_duplicate_id_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["items.json"].append(copy.deepcopy(mutated["items.json"][0]))
        self.assertTrue(any("duplicate ID" in e for e in validator.duplicate_errors(mutated)))

    def test_duplicate_zone_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["zones.json"].append(copy.deepcopy(mutated["zones.json"][0]))
        self.assertTrue(any("duplicate zone" in e for e in validator.duplicate_errors(mutated)))

    def test_duplicate_class_id_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        row = next(r for r in mutated["classes.json"] if r["category"] == "CLASS")
        mutated["classes.json"].append(copy.deepcopy(row))
        self.assertTrue(any("duplicate class ID" in e for e in validator.duplicate_errors(mutated)))

    def test_malformed_entry_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        del mutated["items.json"][0]["name"]
        self.assertTrue(any("malformed catalog entry" in e for e in validator.validate_schema_shape(mutated)))

    def test_missing_source_marker_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["zones.json"][0]["source"] = []
        self.assertTrue(any("missing source marker" in e for e in validator.validate_schema_shape(mutated)))

    def test_invalid_patch_marker_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["skills.json"][0]["patch"] = "1299"
        self.assertTrue(any("invalid patch marker" in e for e in validator.validate_schema_shape(mutated)))

    def test_unresolved_npc_resource_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["npcs.json"][0]["resource_id"] = -999
        self.assertTrue(any("unresolved client resource" in e for e in validator.cross_reference_errors(mutated)))

    def test_unresolved_mob_zone_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["mobs.json"][0]["zone_ids"] = [-999]
        self.assertTrue(any("unresolved zone" in e for e in validator.cross_reference_errors(mutated)))

    def test_unresolved_item_link_detection(self):
        mutated = copy.deepcopy(self.catalogs)
        mutated["skills.json"][0]["exhaust_item_id"] = -999
        self.assertTrue(any("unresolved item" in e for e in validator.cross_reference_errors(mutated)))

    def test_repository_catalog_passes(self):
        errors, summary = validator.validate(ROOT)
        self.assertEqual([], errors)
        self.assertEqual(134, summary["total_records"])
        self.assertEqual(0, summary["unknown_records"])
        self.assertEqual(0, summary["id_collision_count"])
        self.assertEqual(0, summary["missing_source_records"])

if __name__ == "__main__":
    unittest.main()
