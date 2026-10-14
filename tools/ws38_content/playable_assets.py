"""WS38 playable-combat genuine asset staging.

This is a staging layer for the existing Emscripten content pipeline, not a second
KnightOnLine.data packer. It resolves the exact sparse checkout, copies only
manifest-authorized genuine assets into a case-sensitive /data tree, verifies
known integrity metadata, and emits the preload manifest consumed by the
existing browser build.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Iterable

REQUIRED_ENTRY_FIELDS = {
    "logical_id", "group", "consumer", "source_repository", "source_commit",
    "source_path", "sha256", "size", "client_requested_path",
    "packaged_virtual_path", "dependency_parent", "status",
}
PACKAGEABLE = {"READY", "SOURCE_VERIFIED", "SOURCE_DISCOVERED"}


class AssetContractError(RuntimeError):
    pass


def _load(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalized_client_path(value: str) -> str:
    """Normalize separators only. Case is intentionally preserved."""
    return value.replace("\\", "/")


def _relative_vfs_path(entry: dict, package_root: str) -> str:
    virtual = entry["packaged_virtual_path"]
    prefix = package_root.rstrip("/") + "/"
    if not virtual.startswith(prefix):
        raise AssetContractError(
            f"{entry['logical_id']}: packaged path {virtual!r} is outside {package_root!r}"
        )
    rel = virtual[len(prefix):]
    if not rel or rel.startswith("/") or ".." in Path(rel).parts:
        raise AssetContractError(f"{entry['logical_id']}: unsafe virtual path {virtual!r}")
    return rel


def validate_manifest(doc: dict) -> list[str]:
    errors: list[str] = []
    groups = set(doc.get("required_groups", []))
    entries = doc.get("entries", [])
    if not groups:
        errors.append("required_groups is empty")
    seen_ids: set[str] = set()
    seen_virtual: dict[str, str] = {}
    package_root = doc.get("path_policy", {}).get("package_root", "/data")

    for entry in entries:
        missing = REQUIRED_ENTRY_FIELDS - set(entry)
        if missing:
            errors.append(f"{entry.get('logical_id', '<unknown>')}: missing fields {sorted(missing)}")
            continue
        logical_id = entry["logical_id"]
        if logical_id in seen_ids:
            errors.append(f"duplicate logical_id: {logical_id}")
        seen_ids.add(logical_id)
        if entry["group"] not in groups:
            errors.append(f"{logical_id}: unknown group {entry['group']}")

        status = entry["status"]
        if status in PACKAGEABLE:
            for key in ("source_repository", "source_commit", "source_path",
                        "client_requested_path", "packaged_virtual_path"):
                if not entry[key]:
                    errors.append(f"{logical_id}: packageable entry missing {key}")
            if entry["sha256"] is not None:
                value = entry["sha256"]
                if not isinstance(value, str) or len(value) != 64:
                    errors.append(f"{logical_id}: invalid sha256")
            if entry["size"] is not None and (not isinstance(entry["size"], int) or entry["size"] < 0):
                errors.append(f"{logical_id}: invalid size")
            if entry["client_requested_path"] and entry["packaged_virtual_path"]:
                expected = package_root.rstrip("/") + "/" + normalized_client_path(entry["client_requested_path"])
                if expected != entry["packaged_virtual_path"]:
                    errors.append(
                        f"{logical_id}: client path maps to {expected!r}, "
                        f"not {entry['packaged_virtual_path']!r}"
                    )
            try:
                _relative_vfs_path(entry, package_root)
            except AssetContractError as exc:
                errors.append(str(exc))
            virtual = entry["packaged_virtual_path"]
            if virtual in seen_virtual:
                errors.append(
                    f"{logical_id}: duplicate packaged path also owned by {seen_virtual[virtual]}"
                )
            seen_virtual[virtual] = logical_id
        elif not status.startswith("BLOCKED_"):
            errors.append(f"{logical_id}: unsupported status {status}")

    entry_groups = {entry.get("group") for entry in entries}
    for group in sorted(groups - entry_groups):
        errors.append(f"required group has no entry: {group}")
    return errors


def sparse_paths(doc: dict) -> list[str]:
    paths = {
        entry["source_path"]
        for entry in doc["entries"]
        if entry["status"] in PACKAGEABLE and entry["source_path"]
    }
    return sorted(paths)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _exact_case_exists(root: Path, source_path: str) -> bool:
    current = root
    for component in Path(source_path).parts:
        if not current.is_dir():
            return False
        names = {child.name for child in current.iterdir()}
        if component not in names:
            return False
        current = current / component
    return current.is_file()


def stage_assets(doc: dict, asset_root: Path, stage_root: Path) -> dict:
    errors = validate_manifest(doc)
    if errors:
        raise AssetContractError("\n".join(errors))
    package_root = doc["path_policy"]["package_root"]
    resolved = []
    for entry in doc["entries"]:
        if entry["status"] not in PACKAGEABLE:
            continue
        source_rel = entry["source_path"]
        if not _exact_case_exists(asset_root, source_rel):
            raise AssetContractError(
                f"{entry['logical_id']}: exact-case source missing: {source_rel}"
            )
        source = asset_root / source_rel
        actual_size = source.stat().st_size
        actual_sha = _sha256(source)
        expected_size = entry["size"]
        expected_sha = entry["sha256"]
        if expected_size is not None and actual_size != expected_size:
            raise AssetContractError(
                f"{entry['logical_id']}: size {actual_size} != expected {expected_size}"
            )
        if expected_sha is not None and actual_sha != expected_sha:
            raise AssetContractError(
                f"{entry['logical_id']}: sha256 {actual_sha} != expected {expected_sha}"
            )
        rel = _relative_vfs_path(entry, package_root)
        destination = stage_root / package_root.lstrip("/") / rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        resolved.append({
            "logical_id": entry["logical_id"],
            "group": entry["group"],
            "source_path": source_rel,
            "packaged_virtual_path": entry["packaged_virtual_path"],
            "client_requested_path": entry["client_requested_path"],
            "size": actual_size,
            "sha256": actual_sha,
        })

    result = {
        "schema_version": 1,
        "package_root": package_root,
        "assets": sorted(resolved, key=lambda item: item["packaged_virtual_path"]),
        "blocked_groups": sorted({
            entry["group"] for entry in doc["entries"]
            if entry["status"].startswith("BLOCKED_")
        }),
    }
    output = stage_root / "KnightOnLine.data.manifest.json"
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def verify_stage(doc: dict, stage_root: Path) -> None:
    package_root = doc["path_policy"]["package_root"]
    for entry in doc["entries"]:
        if entry["status"] not in PACKAGEABLE:
            continue
        rel = _relative_vfs_path(entry, package_root)
        staged = stage_root / package_root.lstrip("/") / rel
        if not staged.is_file():
            raise AssetContractError(f"{entry['logical_id']}: staged VFS file missing")
        expected_vfs = package_root.rstrip("/") + "/" + normalized_client_path(entry["client_requested_path"])
        if expected_vfs != entry["packaged_virtual_path"]:
            raise AssetContractError(f"{entry['logical_id']}: case/path smoke mismatch")
        if entry["sha256"] is not None and _sha256(staged) != entry["sha256"]:
            raise AssetContractError(f"{entry['logical_id']}: staged sha256 mismatch")


def unresolved_groups(doc: dict) -> list[str]:
    return sorted({
        entry["group"] for entry in doc["entries"]
        if entry["status"].startswith("BLOCKED_")
    })


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--write-sparse-checkout", type=Path)
    parser.add_argument("--asset-root", type=Path)
    parser.add_argument("--stage-root", type=Path)
    parser.add_argument("--verify-stage", action="store_true")
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args(argv)

    doc = _load(args.manifest)
    errors = validate_manifest(doc)
    if errors:
        raise AssetContractError("\n".join(errors))

    if args.write_sparse_checkout:
        args.write_sparse_checkout.parent.mkdir(parents=True, exist_ok=True)
        args.write_sparse_checkout.write_text(
            "".join(path + "\n" for path in sparse_paths(doc)), encoding="utf-8"
        )

    result = None
    if args.asset_root or args.stage_root:
        if not (args.asset_root and args.stage_root):
            raise AssetContractError("--asset-root and --stage-root must be supplied together")
        result = stage_assets(doc, args.asset_root, args.stage_root)
        if args.verify_stage:
            verify_stage(doc, args.stage_root)
        for item in result["assets"]:
            print("WS38_ASSET_RESOLVED " + json.dumps(item, sort_keys=True))

    blocked = unresolved_groups(doc)
    if args.require_complete and blocked:
        raise AssetContractError("unresolved required groups: " + ", ".join(blocked))
    if blocked:
        print("WS38_ASSET_BLOCKED " + ",".join(blocked))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
