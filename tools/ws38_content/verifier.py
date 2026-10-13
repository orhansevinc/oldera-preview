"""Integrity and publication verification for OldKOWeb client content."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from .manifest import (
    ManifestError,
    SignatureVerifier,
    expected_content_type,
    sha256_bytes,
    sha256_file,
    validate_manifest_shape,
    verify_manifest_checksum,
    verify_signature,
)


@dataclass(frozen=True)
class VerificationIssue:
    severity: str
    code: str
    message: str
    path: str | None = None


@dataclass
class VerificationReport:
    ok: bool
    content_version: str | None
    build_id: str | None
    checked_files: int
    issues: list[VerificationIssue]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "contentVersion": self.content_version,
            "buildId": self.build_id,
            "checkedFiles": self.checked_files,
            "issues": [asdict(issue) for issue in self.issues],
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True, indent=2)


def _issue(issues: list[VerificationIssue], severity: str, code: str, message: str, path: str | None = None) -> None:
    issues.append(VerificationIssue(severity, code, message, path))


def _check_pointer(
    pointer: Mapping[str, Any],
    manifest: Mapping[str, Any],
    manifest_bytes: bytes | None,
    issues: list[VerificationIssue],
) -> None:
    if pointer.get("schemaVersion") != manifest.get("schemaVersion"):
        _issue(issues, "error", "LATEST_POINTER_SCHEMA_MISMATCH", "latest pointer schemaVersion differs from manifest")
    if pointer.get("contentVersion") != manifest.get("contentVersion"):
        _issue(
            issues,
            "error",
            "STALE_VERSION",
            f"latest pointer targets {pointer.get('contentVersion')!r}, manifest is {manifest.get('contentVersion')!r}",
        )
    if pointer.get("buildId") != manifest.get("buildId"):
        _issue(issues, "error", "LATEST_POINTER_BUILD_MISMATCH", "latest pointer buildId differs from manifest")
    if pointer.get("manifestChecksum") != manifest.get("manifestChecksum", {}).get("value"):
        _issue(issues, "error", "LATEST_POINTER_CHECKSUM_MISMATCH", "latest pointer manifestChecksum differs from manifest")
    if manifest_bytes is not None:
        expected = pointer.get("manifestFileSha256")
        actual = sha256_bytes(manifest_bytes)
        if expected != actual:
            _issue(issues, "error", "LATEST_POINTER_FILE_HASH_MISMATCH", "latest pointer manifestFileSha256 does not match manifest bytes")


def _check_marker(
    marker: Mapping[str, Any],
    manifest: Mapping[str, Any],
    manifest_bytes: bytes | None,
    issues: list[VerificationIssue],
) -> None:
    expected_pairs = {
        "schemaVersion": manifest.get("schemaVersion"),
        "contentVersion": manifest.get("contentVersion"),
        "buildId": manifest.get("buildId"),
        "manifestChecksum": manifest.get("manifestChecksum", {}).get("value"),
        "fileCount": len(manifest.get("files", [])),
        "requiredFileCount": sum(1 for item in manifest.get("files", []) if item.get("required") is True),
    }
    for key, expected in expected_pairs.items():
        if marker.get(key) != expected:
            _issue(issues, "error", "PUBLICATION_MARKER_MISMATCH", f"publication marker {key} does not match manifest")
    if manifest_bytes is not None and marker.get("manifestFileSha256") != sha256_bytes(manifest_bytes):
        _issue(issues, "error", "PUBLICATION_MARKER_FILE_HASH_MISMATCH", "publication marker manifestFileSha256 does not match manifest bytes")


def verify_directory(
    root: Path,
    manifest: Mapping[str, Any],
    *,
    manifest_bytes: bytes | None = None,
    expected_content_version: str | None = None,
    latest_pointer: Mapping[str, Any] | None = None,
    publication_marker: Mapping[str, Any] | None = None,
    require_publication_marker: bool = False,
    strict_optional: bool = False,
    signature_verifier: SignatureVerifier | None = None,
    require_signature: bool = False,
) -> VerificationReport:
    issues: list[VerificationIssue] = []
    checked_files = 0

    try:
        validate_manifest_shape(manifest)
    except ManifestError as exc:
        _issue(issues, "error", "INVALID_MANIFEST", str(exc))
        return VerificationReport(False, None, None, 0, issues)

    content_version = manifest["contentVersion"]
    build_id = manifest["buildId"]

    try:
        checksum_ok = verify_manifest_checksum(manifest)
    except ManifestError as exc:
        checksum_ok = False
        _issue(issues, "error", "INVALID_MANIFEST", str(exc))
    if not checksum_ok:
        _issue(issues, "error", "MANIFEST_CHECKSUM_MISMATCH", "manifest canonical payload checksum is invalid")

    if expected_content_version is not None and expected_content_version != content_version:
        _issue(
            issues,
            "error",
            "STALE_VERSION",
            f"expected content version {expected_content_version!r}, got {content_version!r}",
        )

    if require_signature or manifest.get("signature") is not None:
        if not verify_signature(manifest, signature_verifier, require_signature=require_signature):
            code = "SIGNATURE_VERIFIER_UNAVAILABLE" if signature_verifier is None else "SIGNATURE_INVALID"
            _issue(issues, "error" if require_signature else "warning", code, "manifest signature was not trusted/verified")

    if latest_pointer is not None:
        _check_pointer(latest_pointer, manifest, manifest_bytes, issues)

    if publication_marker is None and require_publication_marker:
        _issue(issues, "error", "PUBLICATION_MARKER_MISSING", "publication marker is required before latest pointer promotion")
    elif publication_marker is not None:
        _check_marker(publication_marker, manifest, manifest_bytes, issues)

    root = root.resolve()
    for entry in manifest["files"]:
        rel = entry["path"]
        candidate = (root / rel).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            _issue(issues, "error", "PATH_ESCAPE", "manifest file escapes verification root", rel)
            continue

        if not candidate.is_file():
            if entry["required"]:
                _issue(issues, "error", "MISSING_REQUIRED_FILE", "required manifest file is missing", rel)
            else:
                _issue(
                    issues,
                    "error" if strict_optional else "warning",
                    "MISSING_OPTIONAL_FILE",
                    "optional manifest file is missing",
                    rel,
                )
            continue

        checked_files += 1
        actual_size = candidate.stat().st_size
        if actual_size != entry["size"]:
            _issue(
                issues,
                "error",
                "SIZE_MISMATCH",
                f"expected {entry['size']} bytes, got {actual_size}",
                rel,
            )
            # A size mismatch already proves corruption. Still hash to surface a definitive checksum mismatch.

        actual_sha = sha256_file(candidate)
        if actual_sha != entry["sha256"]:
            _issue(issues, "error", "CHECKSUM_MISMATCH", f"expected {entry['sha256']}, got {actual_sha}", rel)

        role = entry.get("role")
        mime_expected = expected_content_type(rel, role)
        if entry.get("contentType") != mime_expected:
            _issue(
                issues,
                "error",
                "CONTENT_TYPE_CONTRACT_MISMATCH",
                f"manifest contentType must be {mime_expected!r} for role/path",
                rel,
            )

    ok = not any(issue.severity == "error" for issue in issues)
    return VerificationReport(ok, content_version, build_id, checked_files, issues)
