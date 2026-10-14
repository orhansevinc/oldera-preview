import hashlib
import json
import unittest
from pathlib import Path

from tools.ws31_data.generate_playable_combat_slice import (
    HASH_PATH,
    JSON_PATH,
    MD_PATH,
    canonical_json_bytes,
    render_md,
    validate,
)


class MoradonPlayableCombatSliceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = JSON_PATH.read_bytes()
        cls.data = json.loads(cls.raw)

    def test_single_authority_is_canonical_and_source_backed(self):
        self.assertEqual(self.raw, canonical_json_bytes(self.data))
        validate(self.data)
        self.assertEqual(self.data["authority_id"], "MORADON_PLAYABLE_COMBAT_SLICE")
        self.assertTrue(self.data["policy"]["single_fixture_authority"])
        self.assertFalse(self.data["policy"]["product_logic"])

    def test_character_weapon_skill_and_target_are_locked(self):
        self.assertEqual(
            (self.data["test_character"]["nation"]["id"],
             self.data["test_character"]["race"]["id"],
             self.data["test_character"]["class"]["id"],
             self.data["test_character"]["level"]),
            (1, 1, 101, 3),
        )
        weapon = self.data["starter_equipment"]["right_hand"]
        self.assertEqual(weapon["item_id"], 120010000)
        self.assertEqual(weapon["damage"], 4)
        self.assertEqual(weapon["attack_delay"]["milliseconds"], 1140)
        self.assertEqual(weapon["range"]["meters"], 1.0)

        skill = self.data["active_skill"]
        self.assertEqual(skill["skill_id"], 101003)
        self.assertEqual(skill["required_level"], 3)
        self.assertEqual(skill["resource"]["cost"], 4)
        self.assertEqual(skill["moral"]["id"], 7)
        self.assertEqual(skill["damage_effect"]["damage_modifier_percent"], 120)

        mob = self.data["target_mob"]
        self.assertEqual(mob["sid"], 850)
        self.assertEqual(mob["name"], "Bandicoot")
        self.assertEqual(mob["spawn"]["row_id"], "npcpos21-850-a")
        self.assertEqual(mob["spawn"]["population"], 5)
        self.assertEqual(mob["spawn"]["respawn_seconds"], 20)

    def test_start_distance_is_not_a_fake_spawn(self):
        move = self.data["player_start_to_mob"]
        self.assertTrue(move["movement_required"])
        self.assertFalse(move["center_inside_target_spawn_rectangle"])
        self.assertEqual(move["start_position"]["karus_center"]["x"], 306)
        self.assertEqual(move["start_position"]["karus_center"]["z"], 352)
        self.assertEqual(move["nearest_verified_rectangle_point_from_center"]["x"], 238)
        self.assertEqual(move["nearest_verified_rectangle_point_from_center"]["z"], 326)
        self.assertEqual(move["nominal_horizontal_straight_line_distance"], 72.801099)
        self.assertIsNone(move["navigable_path_distance"])

    def test_unknowns_are_null_with_blockers(self):
        for entry in self.data["unknowns"]:
            self.assertIsNone(entry["value"])
            self.assertTrue(entry["blocker"])

    def test_browser_asset_state_is_explicit(self):
        self.assertEqual(
            self.data["skill_client_assets"]["icon"]["browser_package_manifest"]["status"],
            "missing",
        )
        self.assertEqual(
            self.data["mob_model_assets"]["browser_package_manifest"]["status"],
            "missing",
        )
        self.assertEqual(self.data["mob_model_assets"]["cross_reference_status"], "match")
        self.assertFalse(self.data["readiness"]["browser_playable_slice_ready"])

    def test_all_consumers_have_one_parseable_projection(self):
        self.assertEqual(set(self.data["consumers"]), {"ws17", "ws19", "ws25", "ws10"})
        for consumer in self.data["consumers"].values():
            self.assertTrue(consumer["parse_ready"])
            self.assertTrue(consumer["projection"])
            self.assertTrue(consumer["head"])

    def test_report_and_hash_manifest_are_derived_from_json(self):
        authority_sha = hashlib.sha256(self.raw).hexdigest()
        self.assertEqual(
            MD_PATH.read_text(encoding="utf-8"),
            render_md(self.data, authority_sha),
        )
        manifest = json.loads(HASH_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            manifest["files"]["MORADON_PLAYABLE_COMBAT_SLICE.json"],
            authority_sha,
        )


if __name__ == "__main__":
    unittest.main()
