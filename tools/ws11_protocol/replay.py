#!/usr/bin/env python3
"""Replay source-verified KO1298 fixture frames.

Live mode sends only C2S frames. It is intentionally packet-agnostic and does
not synthesize server replies or try to become a session server.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import socket
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ko1298 import parse_frames  # noqa: E402


def load_sequence(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def select_steps(sequence: dict, *, channel: str | None, direction: str) -> list[dict]:
    steps = []
    for step in sequence.get("steps", []):
        if channel and step.get("channel") != channel:
            continue
        if step.get("direction") != direction:
            continue
        steps.append(step)
    return steps


def read_step_bytes(sequence_path: Path, step: dict) -> bytes:
    fixture_root = (sequence_path.parent / step.get("fixture_root", "fixtures")).resolve()
    data = (fixture_root / step["fixture"]).read_bytes()
    parse_frames(data)  # fail before replaying malformed fixture bytes
    return data


def replay_to_socket(sequence_path: Path, channel: str, host: str, port: int, *, delay_ms: int = 0) -> list[bytes]:
    sequence = load_sequence(sequence_path)
    steps = select_steps(sequence, channel=channel, direction="C2S")
    if not steps:
        raise ValueError(f"no C2S steps for channel {channel!r}")
    sent: list[bytes] = []
    with socket.create_connection((host, port), timeout=5) as sock:
        for step in steps:
            data = read_step_bytes(sequence_path, step)
            sock.sendall(data)
            sent.append(data)
            if delay_ms:
                time.sleep(delay_ms / 1000.0)
    return sent


def main() -> int:
    p = argparse.ArgumentParser(description="Replay KO1298 fixture sequence; live mode sends C2S only.")
    p.add_argument("sequence", type=Path)
    p.add_argument("--channel", choices=("login", "game"), help="connection stage to replay")
    p.add_argument("--connect", metavar="HOST:PORT", help="send selected C2S fixtures to TCP endpoint")
    p.add_argument("--delay-ms", type=int, default=0)
    p.add_argument("--dry-run", action="store_true", help="print selected fixtures without network I/O")
    args = p.parse_args()

    seq = load_sequence(args.sequence)
    if args.dry_run or not args.connect:
        direction = "C2S"
        steps = select_steps(seq, channel=args.channel, direction=direction)
        for i, step in enumerate(steps, 1):
            data = read_step_bytes(args.sequence, step)
            frame = parse_frames(data)[0]
            print(f"{i:02d} {step['channel']} {direction} {step['fixture']} bytes={len(data)} payload={frame.payload.hex()}")
        return 0

    if not args.channel:
        p.error("--channel is required with --connect because login and game use separate TCP connections")
    host, sep, port_text = args.connect.rpartition(":")
    if not sep or not host:
        p.error("--connect must be HOST:PORT")
    sent = replay_to_socket(args.sequence, args.channel, host, int(port_text), delay_ms=args.delay_ms)
    print(f"replayed {len(sent)} C2S fixture frame(s) on {args.channel} connection")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
