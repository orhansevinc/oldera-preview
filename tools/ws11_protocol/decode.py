#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ko1298 import decode_frame, parse_frames  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser(description="Decode KO 1298 AA55/55AA frames from a binary file or hex string.")
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--file", type=Path, help="raw KO frame/stream file")
    src.add_argument("--hex", dest="hex_data", help="hex-encoded KO frame/stream")
    p.add_argument("--channel", choices=("auto", "login", "game"), default="auto")
    p.add_argument("--direction", choices=("C2S", "S2C", "UNKNOWN"), default="UNKNOWN")
    p.add_argument("--encrypted", action="store_true", help="treat framed payload as opaque encrypted bytes")
    p.add_argument("--allow-trailing", action="store_true", help="permit incomplete trailing bytes")
    args = p.parse_args()

    data = args.file.read_bytes() if args.file else bytes.fromhex(args.hex_data)
    frames = parse_frames(data, allow_trailing=args.allow_trailing)
    decoded = [
        decode_frame(f, channel=args.channel, direction=args.direction, encrypted=args.encrypted)
        for f in frames
    ]
    print(json.dumps(decoded, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
