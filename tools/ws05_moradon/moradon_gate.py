#!/usr/bin/env python3
"""Validate WS05 browser evidence without accepting simulated world output."""
from __future__ import annotations
import argparse
from pathlib import Path
import re

MORADON_WIRE_ZONE_ID = 21
MORADON_NATIVE_ZONE_ID = 210

REQUIRED = (
    "WS04_CHAR_SELECT_RESPONSE success=1",
    "WS05_GATE event=moradon-zone-begin zone=21 native_zone=210",
    "WS05_GATE event=moradon-assets-loaded zone=21 native_zone=210",
    "WS05_GATE event=moradon-terrain-rendered zone=21 native_zone=210",
    "WS05_GATE event=moradon-shapes-rendered zone=21 native_zone=210",
    "WS05_GATE event=moradon-local-player-rendered zone=21 native_zone=210",
    "WS05_MORADON_VISUAL_OK source=pre-swap-gl",
)

FORBIDDEN = (
    "render backend: Null",
    "GL_INVALID_ENUM",
    "GL_INVALID_VALUE",
    "GL_INVALID_OPERATION",
    "WebGL: INVALID_",
    "[pageerror]",
)

ZONE_BEGIN_RE = re.compile(
    rf"WS05_GATE event=moradon-zone-begin zone={MORADON_WIRE_ZONE_ID} "
    rf"native_zone={MORADON_NATIVE_ZONE_ID} "
    r"terrain='([^']+)' colormap='([^']+)' objects='([^']+)'"
)


def validate(text: str) -> list[str]:
    errors: list[str] = []
    for marker in REQUIRED:
        if marker not in text:
            errors.append(f"missing required marker: {marker}")
    for marker in FORBIDDEN:
        if marker in text:
            errors.append(f"forbidden runtime marker present: {marker}")
    m = ZONE_BEGIN_RE.search(text)
    if m:
        for label, value in zip(("terrain", "colormap", "objects"), m.groups()):
            if not value.strip():
                errors.append(f"Moradon zone table returned empty {label} filename")
    else:
        errors.append("Moradon zone-table filename evidence missing")
    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("log", type=Path)
    args = ap.parse_args()
    text = args.log.read_text(encoding="utf-8", errors="replace")
    errors = validate(text)
    if errors:
        print("WS05_MORADON_GATE=FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("WS05_MORADON_GATE=PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
