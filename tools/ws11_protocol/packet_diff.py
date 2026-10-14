#!/usr/bin/env python3
from __future__ import annotations
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay import ProtocolError, parse_frame

def first_diff(a: bytes, b: bytes):
    for i,(x,y) in enumerate(zip(a,b)):
        if x!=y: return i,x,y
    if len(a)!=len(b): return min(len(a),len(b)), None, None
    return None

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("left", type=Path); ap.add_argument("right", type=Path)
    ns=ap.parse_args()
    a=ns.left.read_bytes(); b=ns.right.read_bytes()
    diff=first_diff(a,b)
    print(f"left_bytes={len(a)} right_bytes={len(b)} identical={diff is None}")
    if diff:
        i,x,y=diff
        print(f"first_diff_offset={i} left={None if x is None else f'0x{x:02X}'} right={None if y is None else f'0x{y:02X}'}")
    for label,raw in (("left",a),("right",b)):
        try:
            p=parse_frame(raw)
            print(f"{label}_opcode=0x{p[0]:02X} {label}_payload_bytes={len(p)}")
        except ProtocolError as exc:
            print(f"{label}_frame_error={exc}")
    raise SystemExit(0 if diff is None else 1)

if __name__=="__main__":
    main()
