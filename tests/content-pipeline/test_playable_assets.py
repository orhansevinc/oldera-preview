import hashlib
import tempfile
import unittest
from pathlib import Path

from tools.ws38_content.playable_assets import (
    AssetContractError,
    normalized_client_path,
    sparse_paths,
    stage_assets,
    validate_manifest,
    verify_stage,
)


def entry(**overrides):
    base = {
        "logical_id": "asset",
        "group": "GROUP",
        "consumer": "client",
        "source_repository": "repo",
        "source_commit": "a" * 40,
        "source_path": "Chr/A.bin",
        "sha256": None,
        "size": None,
        "client_requested_path": r"chr\A.bin",
        "packaged_virtual_path": "/data/chr/A.bin",
        "dependency_parent": "root",
        "status": "SOURCE_DISCOVERED",
    }
    base.update(overrides)
    return base


def document(entries):
    return {
        "path_policy": {"package_root": "/data"},
        "required_groups": ["GROUP"],
        "entries": entries,
    }


class PlayableAssetTests(unittest.TestCase):
    def test_separator_normalization_does_not_casefold(self):
        self.assertEqual(normalized_client_path(r"UI\Skill.DXT"), "UI/Skill.DXT")

    def test_manifest_rejects_case_changed_vfs_alias(self):
        doc = document([entry(packaged_virtual_path="/data/Chr/A.bin")])
        self.assertTrue(any("client path maps" in value for value in validate_manifest(doc)))

    def test_sparse_checkout_is_exact_and_deduplicated(self):
        doc = document([
            entry(logical_id="a"),
            entry(logical_id="b", client_requested_path=r"chr\B.bin",
                  packaged_virtual_path="/data/chr/B.bin", source_path="Item/B.bin"),
        ])
        self.assertEqual(sparse_paths(doc), ["Chr/A.bin", "Item/B.bin"])

    def test_stage_computes_hash_and_preserves_requested_case(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            stage = root / "stage"
            (source / "Chr").mkdir(parents=True)
            payload = b"genuine"
            (source / "Chr/A.bin").write_bytes(payload)
            doc = document([entry(size=len(payload), sha256=hashlib.sha256(payload).hexdigest())])
            result = stage_assets(doc, source, stage)
            verify_stage(doc, stage)
            self.assertEqual((stage / "data/chr/A.bin").read_bytes(), payload)
            self.assertEqual(result["assets"][0]["sha256"], hashlib.sha256(payload).hexdigest())

    def test_stage_fails_exact_case_source_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            stage = root / "stage"
            (source / "chr").mkdir(parents=True)
            (source / "chr/A.bin").write_bytes(b"x")
            with self.assertRaises(AssetContractError):
                stage_assets(document([entry()]), source, stage)


if __name__ == "__main__":
    unittest.main()
