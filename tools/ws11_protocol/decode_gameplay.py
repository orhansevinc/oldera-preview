#!/usr/bin/env python3
"""Pretty-print one or more strict KO1298 gameplay frames."""
from __future__ import annotations
import argparse, json, struct
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay import ProtocolError, decode_frame

def split_frames(raw: bytes):
    off=0
    while off < len(raw):
        if len(raw)-off < 7 or raw[off:off+2] != b'\xaa\x55':
            raise ProtocolError(f'invalid/truncated frame at offset {off}')
        n=struct.unpack_from('<H',raw,off+2)[0]
        end=off+n+6
        if end>len(raw) or raw[end-2:end] != b'\x55\xaa':
            raise ProtocolError(f'invalid/truncated frame at offset {off}')
        yield raw[off:end]
        off=end

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--file', required=True, type=Path)
    ap.add_argument('--direction', required=True, choices=['C2S','S2C'])
    ns=ap.parse_args()
    out=[decode_frame(frame,ns.direction) for frame in split_frames(ns.file.read_bytes())]
    print(json.dumps(out, indent=2, sort_keys=True))
if __name__=='__main__': main()
