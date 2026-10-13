"""CLI manifest generator for the WS38 content contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .manifest import (
    ManifestError,
    build_latest_pointer,
    build_manifest,
    build_publication_marker,
    load_profile,
    serialize_manifest,
)


def _json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate OldKOWeb immutable client content manifest")
    parser.add_argument("--root", required=True, type=Path, help="Directory containing the browser package")
    parser.add_argument("--profile", required=True, type=Path, help="JSON file list/profile")
    parser.add_argument("--content-version", required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--source-commit", required=True, help="Lowercase full 40-character Git commit SHA")
    parser.add_argument("--source-ref", default=None)
    parser.add_argument("--output", required=True, type=Path, help="Manifest output path")
    parser.add_argument("--immutable-base-path", default=None)
    parser.add_argument("--cdn-manifest-path", default=None, help="Relative CDN path used by latest.json")
    parser.add_argument("--latest-output", type=Path, default=None)
    parser.add_argument("--publication-marker-output", type=Path, default=None)
    parser.add_argument("--cdn-publication-marker-path", default=None)
    parser.add_argument("--rollback-content-version", default=None)
    parser.add_argument("--rollback-manifest-path", default=None)
    parser.add_argument("--rollback-manifest-sha256", default=None)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    rollback_values = (
        args.rollback_content_version,
        args.rollback_manifest_path,
        args.rollback_manifest_sha256,
    )
    if any(value is not None for value in rollback_values) and not all(value is not None for value in rollback_values):
        print("error: rollback options must be supplied together", file=sys.stderr)
        return 2
    if args.latest_output is not None and args.cdn_manifest_path is None:
        print("error: --latest-output requires --cdn-manifest-path", file=sys.stderr)
        return 2
    if args.cdn_publication_marker_path is not None and args.publication_marker_output is None:
        print("error: --cdn-publication-marker-path requires --publication-marker-output", file=sys.stderr)
        return 2

    rollback = None
    if all(value is not None for value in rollback_values):
        rollback = {
            "contentVersion": args.rollback_content_version,
            "manifestPath": args.rollback_manifest_path,
            "manifestFileSha256": args.rollback_manifest_sha256,
        }

    try:
        specs = load_profile(args.profile)
        manifest = build_manifest(
            args.root,
            specs,
            content_version=args.content_version,
            build_id=args.build_id,
            source_commit=args.source_commit,
            source_ref=args.source_ref,
            immutable_base_path=args.immutable_base_path,
            rollback=rollback,
        )
    except (ManifestError, OSError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    manifest_bytes = serialize_manifest(manifest)
    _write(args.output, manifest_bytes)

    marker = None
    if args.publication_marker_output is not None:
        marker = build_publication_marker(manifest, manifest_bytes)
        _write(args.publication_marker_output, _json_bytes(marker))

    if args.latest_output is not None:
        marker_path = args.cdn_publication_marker_path if marker is not None else None
        pointer = build_latest_pointer(
            manifest,
            manifest_bytes,
            manifest_path=args.cdn_manifest_path,
            publication_marker_path=marker_path,
        )
        _write(args.latest_output, _json_bytes(pointer))

    print(
        json.dumps(
            {
                "ok": True,
                "contentVersion": manifest["contentVersion"],
                "buildId": manifest["buildId"],
                "fileCount": len(manifest["files"]),
                "manifestChecksum": manifest["manifestChecksum"]["value"],
                "output": str(args.output),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
