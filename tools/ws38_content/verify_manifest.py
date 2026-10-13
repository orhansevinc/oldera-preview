"""CLI verifier for local/staged OldKOWeb client content."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .verifier import verify_directory


def _read_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify OldKOWeb client content against its manifest")
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--expected-content-version", default=None)
    parser.add_argument("--latest-pointer", type=Path, default=None)
    parser.add_argument("--publication-marker", type=Path, default=None)
    parser.add_argument("--require-publication-marker", action="store_true")
    parser.add_argument("--strict-optional", action="store_true")
    parser.add_argument(
        "--require-signature",
        action="store_true",
        help="Fail unless a trusted signature verifier is integrated by the caller; CLI intentionally has no private/public key config",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        manifest_bytes = args.manifest.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        latest = _read_json(args.latest_pointer) if args.latest_pointer else None
        marker = _read_json(args.publication_marker) if args.publication_marker else None
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2

    report = verify_directory(
        args.root,
        manifest,
        manifest_bytes=manifest_bytes,
        expected_content_version=args.expected_content_version,
        latest_pointer=latest,
        publication_marker=marker,
        require_publication_marker=args.require_publication_marker,
        strict_optional=args.strict_optional,
        require_signature=args.require_signature,
    )
    print(report.to_json())
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
