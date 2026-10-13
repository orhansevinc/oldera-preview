from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tools.ws38_content.manifest import (
    FileSpec,
    ManifestError,
    build_latest_pointer,
    build_manifest,
    build_publication_marker,
    compute_manifest_checksum,
    serialize_manifest,
    verify_manifest_checksum,
    verify_signature,
)
from tools.ws38_content.verifier import verify_directory


COMMIT = "a" * 40


class FakeSigner:
    algorithm = "test-sha256-echo"
    key_id = "test-key"

    def sign(self, digest: bytes) -> bytes:
        return b"signed:" + digest


class FakeVerifier:
    def verify(self, algorithm: str, key_id: str, digest: bytes, signature: bytes) -> bool:
        return (
            algorithm == "test-sha256-echo"
            and key_id == "test-key"
            and signature == b"signed:" + digest
        )


class ManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "index.html").write_text("<html>OldKOWeb</html>\n", encoding="utf-8")
        (self.root / "KnightOnLine.js").write_text("console.log('ko');\n", encoding="utf-8")
        (self.root / "KnightOnLine.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00test")
        (self.root / "KnightOnLine.data").write_bytes(b"data" * 128)
        (self.root / "BUILD.txt").write_text("test build\n", encoding="utf-8")
        self.specs = [
            FileSpec("index.html", True, "html"),
            FileSpec("KnightOnLine.js", True, "loader-js"),
            FileSpec("KnightOnLine.wasm", True, "wasm"),
            FileSpec("KnightOnLine.data", True, "data"),
            FileSpec("BUILD.txt", False, "metadata"),
        ]

    def tearDown(self) -> None:
        self.temp.cleanup()

    def manifest(self, **kwargs):
        options = {
            "content_version": "1298-test.1",
            "build_id": "test-build-1",
            "source_commit": COMMIT,
            "source_ref": "test",
            "created_at": "2026-10-14T01:00:00Z",
        }
        options.update(kwargs)
        return build_manifest(self.root, self.specs, **options)

    def test_manifest_binds_real_package_roles_size_and_checksum(self) -> None:
        manifest = self.manifest()
        by_path = {entry["path"]: entry for entry in manifest["files"]}
        self.assertEqual("application/wasm", by_path["KnightOnLine.wasm"]["contentType"])
        self.assertEqual("application/octet-stream", by_path["KnightOnLine.data"]["contentType"])
        self.assertEqual((self.root / "KnightOnLine.data").stat().st_size, by_path["KnightOnLine.data"]["size"])
        self.assertEqual(64, len(by_path["KnightOnLine.data"]["sha256"]))
        self.assertTrue(verify_manifest_checksum(manifest))

    def test_generator_fails_when_required_file_is_missing(self) -> None:
        (self.root / "KnightOnLine.data").unlink()
        with self.assertRaisesRegex(ManifestError, "required file is missing"):
            self.manifest()

    def test_optional_missing_file_is_omitted_at_generation_time(self) -> None:
        (self.root / "BUILD.txt").unlink()
        manifest = self.manifest()
        paths = {entry["path"] for entry in manifest["files"]}
        self.assertNotIn("BUILD.txt", paths)
        self.assertIn("KnightOnLine.data", paths)

    def test_manifest_checksum_detects_semantic_tampering(self) -> None:
        manifest = self.manifest()
        manifest["files"][0]["size"] += 1
        self.assertFalse(verify_manifest_checksum(manifest))

    def test_verifier_passes_complete_release_pointer_and_marker(self) -> None:
        manifest = self.manifest()
        raw = serialize_manifest(manifest)
        marker = build_publication_marker(manifest, raw, published_at="2026-10-14T01:01:00Z")
        pointer = build_latest_pointer(
            manifest,
            raw,
            manifest_path="client-content/v1/1298-test.1/manifest.json",
            publication_marker_path="client-content/v1/1298-test.1/_complete.json",
            published_at="2026-10-14T01:02:00Z",
        )
        report = verify_directory(
            self.root,
            manifest,
            manifest_bytes=raw,
            expected_content_version="1298-test.1",
            latest_pointer=pointer,
            publication_marker=marker,
            require_publication_marker=True,
        )
        self.assertTrue(report.ok, report.to_json())
        self.assertEqual(5, report.checked_files)

    def test_corrupt_asset_is_detected_by_size_and_checksum(self) -> None:
        manifest = self.manifest()
        (self.root / "KnightOnLine.data").write_bytes(b"corrupt")
        report = verify_directory(self.root, manifest)
        codes = {issue.code for issue in report.issues}
        self.assertFalse(report.ok)
        self.assertIn("SIZE_MISMATCH", codes)
        self.assertIn("CHECKSUM_MISMATCH", codes)

    def test_missing_required_asset_is_detected(self) -> None:
        manifest = self.manifest()
        (self.root / "KnightOnLine.wasm").unlink()
        report = verify_directory(self.root, manifest)
        self.assertFalse(report.ok)
        self.assertIn("MISSING_REQUIRED_FILE", {issue.code for issue in report.issues})

    def test_stale_version_is_detected(self) -> None:
        manifest = self.manifest()
        report = verify_directory(self.root, manifest, expected_content_version="1298-newer.2")
        self.assertFalse(report.ok)
        self.assertIn("STALE_VERSION", {issue.code for issue in report.issues})

    def test_partial_upload_without_completion_marker_is_rejected(self) -> None:
        manifest = self.manifest()
        report = verify_directory(self.root, manifest, require_publication_marker=True)
        self.assertFalse(report.ok)
        self.assertIn("PUBLICATION_MARKER_MISSING", {issue.code for issue in report.issues})

    def test_latest_pointer_manifest_file_hash_mismatch_is_detected(self) -> None:
        manifest = self.manifest()
        raw = serialize_manifest(manifest)
        pointer = build_latest_pointer(
            manifest,
            raw,
            manifest_path="client-content/v1/1298-test.1/manifest.json",
        )
        pointer["manifestFileSha256"] = "0" * 64
        report = verify_directory(self.root, manifest, manifest_bytes=raw, latest_pointer=pointer)
        self.assertFalse(report.ok)
        self.assertIn("LATEST_POINTER_FILE_HASH_MISMATCH", {issue.code for issue in report.issues})

    def test_wrong_wasm_mime_contract_is_rejected(self) -> None:
        manifest = self.manifest()
        wasm = next(item for item in manifest["files"] if item["path"] == "KnightOnLine.wasm")
        wasm["contentType"] = "application/octet-stream"
        manifest["manifestChecksum"]["value"] = compute_manifest_checksum(manifest)
        report = verify_directory(self.root, manifest)
        self.assertFalse(report.ok)
        self.assertIn("CONTENT_TYPE_CONTRACT_MISMATCH", {issue.code for issue in report.issues})

    def test_path_traversal_is_rejected(self) -> None:
        with self.assertRaisesRegex(ManifestError, "unsafe file path"):
            build_manifest(
                self.root,
                [FileSpec("../secret", True, "asset")],
                content_version="1298-test.1",
                build_id="test-build-1",
                source_commit=COMMIT,
            )

    def test_detached_signature_interface_is_external_and_verifiable(self) -> None:
        manifest = self.manifest(signing_provider=FakeSigner())
        self.assertTrue(verify_manifest_checksum(manifest))
        self.assertTrue(verify_signature(manifest, FakeVerifier(), require_signature=True))
        self.assertFalse(verify_signature(manifest, None, require_signature=True))

    def test_missing_optional_file_after_manifest_is_warning_by_default(self) -> None:
        manifest = self.manifest()
        (self.root / "BUILD.txt").unlink()
        report = verify_directory(self.root, manifest)
        self.assertTrue(report.ok, report.to_json())
        warning_codes = {issue.code for issue in report.issues if issue.severity == "warning"}
        self.assertIn("MISSING_OPTIONAL_FILE", warning_codes)

    def test_marker_bound_to_different_release_is_rejected(self) -> None:
        manifest = self.manifest()
        raw = serialize_manifest(manifest)
        marker = build_publication_marker(manifest, raw)
        marker["contentVersion"] = "1298-other.1"
        report = verify_directory(
            self.root,
            manifest,
            manifest_bytes=raw,
            publication_marker=marker,
            require_publication_marker=True,
        )
        self.assertFalse(report.ok)
        self.assertIn("PUBLICATION_MARKER_MISMATCH", {issue.code for issue in report.issues})


if __name__ == "__main__":
    unittest.main()
