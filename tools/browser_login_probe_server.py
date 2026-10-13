#!/usr/bin/env python3
"""Tiny TCP login probe used only by the browser CI smoke test.

It verifies that the real 1298 client emitted a correctly framed
LS_SERVERLIST request after traversing the WebSocket->TCP bridge, then sends
back a valid empty LS_SERVERLIST response so the client can keep running.
"""

import argparse
import socket
import struct
from pathlib import Path

HEADER = b"\xAA\x55"
TAIL = b"\x55\xAA"
LS_SERVERLIST = 0xF5


def recv_exact(conn: socket.socket, count: int) -> bytes:
    chunks = []
    left = count
    while left:
        part = conn.recv(left)
        if not part:
            raise ConnectionError(f"connection closed with {left} byte(s) remaining")
        chunks.append(part)
        left -= len(part)
    return b"".join(chunks)


def frame(payload: bytes) -> bytes:
    return HEADER + struct.pack("<H", len(payload)) + payload + TAIL


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=15101)
    ap.add_argument("--marker", default="browser-network.txt")
    args = ap.parse_args()

    marker = Path(args.marker)
    marker.unlink(missing_ok=True)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as srv:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((args.host, args.port))
        srv.listen(1)
        print(f"[probe] listening on {args.host}:{args.port}", flush=True)
        conn, addr = srv.accept()
        with conn:
            conn.settimeout(30)
            print(f"[probe] accepted {addr[0]}:{addr[1]}", flush=True)
            header = recv_exact(conn, 4)
            if header[:2] != HEADER:
                raise RuntimeError(f"bad KO header: {header[:2].hex()}")
            size = struct.unpack("<H", header[2:4])[0]
            payload = recv_exact(conn, size)
            tail = recv_exact(conn, 2)
            if tail != TAIL:
                raise RuntimeError(f"bad KO tail: {tail.hex()}")
            if not payload or payload[0] != LS_SERVERLIST:
                got = payload[0] if payload else None
                raise RuntimeError(f"expected LS_SERVERLIST 0xF5, got {got!r}")

            text = (
                "NETWORK_OK\n"
                f"frame={HEADER.hex()} {size:04x} {payload.hex()} {TAIL.hex()}\n"
                f"opcode=0x{payload[0]:02X}\n"
            )
            marker.write_text(text, encoding="utf-8")
            print("[probe] NETWORK_OK genuine LS_SERVERLIST received", flush=True)

            # Command byte + zero server count.  This is a syntactically valid
            # login-server response and keeps the real receive/dispatch path alive.
            conn.sendall(frame(bytes([LS_SERVERLIST, 0x00])))

            # Keep the TCP side alive while Chromium finishes its visual/runtime gate.
            try:
                while conn.recv(4096):
                    pass
            except (socket.timeout, ConnectionError):
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
