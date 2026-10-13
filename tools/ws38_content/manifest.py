"""OldKOWeb client content manifest primitives.

This module deliberately uses only the Python standard library so the
publication checks can run in CI, release jobs, or a minimal launcher build
without installing third-party packages.
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping, Protocol

SCHEMA_VERSION = 1
CANONICALIZATION = "oldkoweb-json-v1"
CHECKSUM_ALGORITHM = "sha256"
_HEX_64_RE = re.compile(r"^[0-9a-f]{64}$")
_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_CONTENT_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
_BUILD_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$")

ROLE_CONTENT_TYPES = {
    "loader-js": "text/javascript; charset=utf-8",
    "wasm": "application/wasm",
    "data": "application/octet-stream",
    "html": "text/html; charset=utf-8",
    "metadata": "text/plain; charset=utf-8",
}


class ManifestError(ValueError):
    """Raised when a manifest or generator input is structurally invalid."""


class SigningProvider(Protocol):
    """Interface only: implementations must keep private keys outside the repo."""

    algorithm: str
    key_id: str

    def sign(self, digest: bytes) -> bytes:
        """Return a detached signature for the 32-byte manifest SHA-256 digest."""


class SignatureVerifier(Protocol):
    """Interface for environments that want mandatory detached signatures."""

    def verify(self, algorithm: str, key_id: str, digest: bytes, signature: bytes) -> bool:
        """Return True only when the detached signature is trusted and valid."""


@dataclass(frozen=True)
class FileSpec:
    path: str
    required: bool = True
    role: str = "asset"
    content_type: str | None = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_relative_path(value: str) -> str:
    if not isinstance(value, str) or not value:
        raise ManifestError("file path must be a non-empty string")
    if "\\" in value:
        raise ManifestError(f"file path must use POSIX separators: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or value.startswith("/"):
        raise ManifestError(f"file path must be relative: {value!r}")
    if any(part in ("", ".", "..") for part in path.parts):
        raise ManifestError(f"unsafe file path: {value!r}")
    normalized = path.as_posix()
    if normalized != value:
        raise ManifestError(f"file path must already be normalized: {value!r}")
    return normalized


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    """OldKOWeb canonical JSON v1: UTF-8, sorted keys, no insignificant spaces."""
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def checksum_payload(manifest: Mapping[str, Any]) -> dict[str, Any]:
    payload = dict(manifest)
    payload.pop("manifestChecksum", None)
    payload.pop("signature", None)
    return payload


def compute_manifest_checksum(manifest: Mapping[str, Any]) -> str:
    return sha256_bytes(canonical_json_bytes(checksum_payload(manifest)))


def expected_content_type(path: str, role: str | None = None) -> str:
    if role in ROLE_CONTENT_TYPES:
        return ROLE_CONTENT_TYPES[role]
    suffix = Path(path).suffix.lower()
    if suffix == ".wasm":
        return "application/wasm"
    if suffix == ".data":
        return "application/octet-stream"
    if suffix in (".js", ".mjs"):
        return "text/javascript; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    if suffix in (".html", ".htm"):
        return "text/html; charset=utf-8"
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def load_profile(path: Path) -> list[FileSpec]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    files = raw.get("files") if isinstance(raw, dict) else None
    if not isinstance(files, list) or not files:
        raise ManifestError("profile.files must be a non-empty array")
    result: list[FileSpec] = []
    seen: set[str] = set()
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            raise ManifestError(f"profile.files[{index}] must be an object")
        rel = safe_relative_path(item.get("path"))
        if rel in seen:
            raise ManifestError(f"duplicate profile path: {rel}")
        seen.add(rel)
        required = item.get("required", True)
        role = item.get("role", "asset")
        content_type = item.get("contentType")
        if not isinstance(required, bool):
            raise ManifestError(f"required must be boolean for {rel}")
        if not isinstance(role, str) or not role:
            raise ManifestError(f"role must be a non-empty string for {rel}")
        if content_type is not None and (not isinstance(content_type, str) or not content_type):
            raise ManifestError(f"contentType must be a non-empty string for {rel}")
        result.append(FileSpec(rel, required, role, content_type))
    return result


def _validate_identity(content_version: str, build_id: str, source_commit: str) -> None:
    if not isinstance(content_version, str) or not _CONTENT_VERSION_RE.fullmatch(content_version):
        raise ManifestError("contentVersion must match [A-Za-z0-9][A-Za-z0-9._-]{0,95}")
    if not isinstance(build_id, str) or not _BUILD_ID_RE.fullmatch(build_id):
        raise ManifestError("buildId contains unsupported characters or is too long")
    if not isinstance(source_commit, str) or not _COMMIT_RE.fullmatch(source_commit):
        raise ManifestError("source commit must be a lowercase 40-character Git SHA-1")


def build_manifest(
    root: Path,
    specs: Iterable[FileSpec],
    *,
    content_version: str,
    build_id: str,
    source_commit: str,
    source_ref: str | None = None,
    created_at: str | None = None,
    immutable_base_path: str | None = None,
    rollback: Mapping[str, str] | None = None,
    signing_provider: SigningProvider | None = None,
) -> dict[str, Any]:
    _validate_identity(content_version, build_id, source_commit)
    root = root.resolve()
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()

    for spec in specs:
        rel = safe_relative_path(spec.path)
        if rel in seen:
            raise ManifestError(f"duplicate manifest path: {rel}")
        seen.add(rel)
        candidate = (root / rel).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ManifestError(f"file escapes content root: {rel}") from exc
        if not candidate.is_file():
            if spec.required:
                raise ManifestError(f"required file is missing: {rel}")
            continue
        entries.append(
            {
                "path": rel,
                "size": candidate.stat().st_size,
                "sha256": sha256_file(candidate),
                "required": spec.required,
                "role": spec.role,
                "contentType": spec.content_type or expected_content_type(rel, spec.role),
            }
        )

    if not entries:
        raise ManifestError("manifest would contain no files")

    if immutable_base_path is None:
        immutable_base_path = f"/client-content/v1/{content_version}/"
    if not isinstance(immutable_base_path, str) or not immutable_base_path.startswith("/") or not immutable_base_path.endswith("/"):
        raise ManifestError("immutableBasePath must start and end with '/'")

    manifest: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "contentVersion": content_version,
        "buildId": build_id,
        "createdAt": created_at or utc_now_iso(),
        "source": {"commit": source_commit},
        "immutableBasePath": immutable_base_path,
        "files": sorted(entries, key=lambda item: item["path"]),
    }
    if source_ref:
        manifest["source"]["ref"] = source_ref
    if rollback is not None:
        required = {"contentVersion", "manifestPath", "manifestFileSha256"}
        if set(rollback) != required:
            raise ManifestError(f"rollback must contain exactly {sorted(required)}")
        if not _HEX_64_RE.fullmatch(str(rollback["manifestFileSha256"])):
            raise ManifestError("rollback.manifestFileSha256 must be lowercase SHA-256 hex")
        safe_relative_path(str(rollback["manifestPath"]))
        manifest["rollback"] = dict(rollback)

    checksum_value = compute_manifest_checksum(manifest)
    manifest["manifestChecksum"] = {
        "algorithm": CHECKSUM_ALGORITHM,
        "canonicalization": CANONICALIZATION,
        "value": checksum_value,
    }

    if signing_provider is not None:
        signature = signing_provider.sign(bytes.fromhex(checksum_value))
        manifest["signature"] = {
            "algorithm": signing_provider.algorithm,
            "keyId": signing_provider.key_id,
            "signedField": "manifestChecksum.value",
            "value": base64.b64encode(signature).decode("ascii"),
        }

    validate_manifest_shape(manifest)
    return manifest


def validate_manifest_shape(manifest: Mapping[str, Any]) -> None:
    if not isinstance(manifest, Mapping):
        raise ManifestError("manifest must be an object")
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise ManifestError(f"unsupported schemaVersion: {manifest.get('schemaVersion')!r}")
    _validate_identity(
        manifest.get("contentVersion"),
        manifest.get("buildId"),
        manifest.get("source", {}).get("commit") if isinstance(manifest.get("source"), Mapping) else None,
    )
    created_at = manifest.get("createdAt")
    if not isinstance(created_at, str) or not created_at.endswith("Z"):
        raise ManifestError("createdAt must be an RFC3339 UTC string ending in Z")
    base_path = manifest.get("immutableBasePath")
    if not isinstance(base_path, str) or not base_path.startswith("/") or not base_path.endswith("/"):
        raise ManifestError("immutableBasePath must start and end with '/'")

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise ManifestError("files must be a non-empty array")
    seen: set[str] = set()
    for index, item in enumerate(files):
        if not isinstance(item, Mapping):
            raise ManifestError(f"files[{index}] must be an object")
        rel = safe_relative_path(item.get("path"))
        if rel in seen:
            raise ManifestError(f"duplicate manifest path: {rel}")
        seen.add(rel)
        size = item.get("size")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise ManifestError(f"files[{index}].size must be a non-negative integer")
        sha = item.get("sha256")
        if not isinstance(sha, str) or not _HEX_64_RE.fullmatch(sha):
            raise ManifestError(f"files[{index}].sha256 must be lowercase SHA-256 hex")
        if not isinstance(item.get("required"), bool):
            raise ManifestError(f"files[{index}].required must be boolean")
        if not isinstance(item.get("role"), str) or not item.get("role"):
            raise ManifestError(f"files[{index}].role must be a non-empty string")
        if not isinstance(item.get("contentType"), str) or not item.get("contentType"):
            raise ManifestError(f"files[{index}].contentType must be a non-empty string")

    checksum = manifest.get("manifestChecksum")
    if not isinstance(checksum, Mapping):
        raise ManifestError("manifestChecksum must be an object")
    if checksum.get("algorithm") != CHECKSUM_ALGORITHM:
        raise ManifestError("manifestChecksum.algorithm must be sha256")
    if checksum.get("canonicalization") != CANONICALIZATION:
        raise ManifestError(f"manifestChecksum.canonicalization must be {CANONICALIZATION}")
    value = checksum.get("value")
    if not isinstance(value, str) or not _HEX_64_RE.fullmatch(value):
        raise ManifestError("manifestChecksum.value must be lowercase SHA-256 hex")

    signature = manifest.get("signature")
    if signature is not None:
        if not isinstance(signature, Mapping):
            raise ManifestError("signature must be an object")
        for key in ("algorithm", "keyId", "value"):
            if not isinstance(signature.get(key), str) or not signature.get(key):
                raise ManifestError(f"signature.{key} must be a non-empty string")
        if signature.get("signedField") != "manifestChecksum.value":
            raise ManifestError("signature.signedField must be manifestChecksum.value")
        try:
            base64.b64decode(signature["value"], validate=True)
        except Exception as exc:
            raise ManifestError("signature.value must be valid base64") from exc


def verify_manifest_checksum(manifest: Mapping[str, Any]) -> bool:
    validate_manifest_shape(manifest)
    return manifest["manifestChecksum"]["value"] == compute_manifest_checksum(manifest)


def verify_signature(
    manifest: Mapping[str, Any],
    verifier: SignatureVerifier | None,
    *,
    require_signature: bool = False,
) -> bool:
    signature = manifest.get("signature")
    if signature is None:
        return not require_signature
    if verifier is None:
        return not require_signature
    raw_signature = base64.b64decode(signature["value"], validate=True)
    digest = bytes.fromhex(manifest["manifestChecksum"]["value"])
    return verifier.verify(signature["algorithm"], signature["keyId"], digest, raw_signature)


def serialize_manifest(manifest: Mapping[str, Any]) -> bytes:
    """Stable human-readable on-disk representation; checksum uses canonical payload above."""
    return (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def build_latest_pointer(
    manifest: Mapping[str, Any],
    manifest_bytes: bytes,
    *,
    manifest_path: str,
    publication_marker_path: str | None = None,
    published_at: str | None = None,
) -> dict[str, Any]:
    validate_manifest_shape(manifest)
    manifest_path = safe_relative_path(manifest_path)
    pointer: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "contentVersion": manifest["contentVersion"],
        "buildId": manifest["buildId"],
        "publishedAt": published_at or utc_now_iso(),
        "manifestPath": manifest_path,
        "manifestFileSha256": sha256_bytes(manifest_bytes),
        "manifestChecksum": manifest["manifestChecksum"]["value"],
    }
    if publication_marker_path:
        pointer["publicationMarkerPath"] = safe_relative_path(publication_marker_path)
    return pointer


def build_publication_marker(
    manifest: Mapping[str, Any],
    manifest_bytes: bytes,
    *,
    published_at: str | None = None,
) -> dict[str, Any]:
    validate_manifest_shape(manifest)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "contentVersion": manifest["contentVersion"],
        "buildId": manifest["buildId"],
        "publishedAt": published_at or utc_now_iso(),
        "manifestFileSha256": sha256_bytes(manifest_bytes),
        "manifestChecksum": manifest["manifestChecksum"]["value"],
        "fileCount": len(manifest["files"]),
        "requiredFileCount": sum(1 for entry in manifest["files"] if entry["required"]),
    }
