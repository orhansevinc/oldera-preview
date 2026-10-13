#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path

MIN_SIZE = {
    "KnightOnLine.js": 100_000,
    "KnightOnLine.wasm": 1_000_000,
    "KnightOnLine.data": 50_000_000,
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"PACKAGE_FAIL: {message}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Verify the OldKOWeb Emscripten browser package.")
    ap.add_argument("--dir", required=True, dest="package_dir")
    ap.add_argument("--index")
    ap.add_argument("--manifest")
    ap.add_argument("--openko-sha", default=os.environ.get("OPENKO_SHA", ""))
    ap.add_argument("--assets-sha", default=os.environ.get("KO_ASSETS_SHA", ""))
    ap.add_argument("--emscripten-version", default=os.environ.get("EMSDK_VERSION", ""))
    args = ap.parse_args()

    package_dir = Path(args.package_dir)
    require(package_dir.is_dir(), f"package directory not found: {package_dir}")

    files: dict[str, dict[str, object]] = {}
    for name, minimum in MIN_SIZE.items():
        path = package_dir / name
        require(path.is_file(), f"missing {name}")
        size = path.stat().st_size
        require(size >= minimum, f"{name} is suspiciously small ({size} < {minimum})")
        files[name] = {"size": size, "sha256": sha256(path)}

    wasm = package_dir / "KnightOnLine.wasm"
    with wasm.open("rb") as f:
        header = f.read(8)
    require(header == b"\x00asm\x01\x00\x00\x00", f"invalid WASM header: {header!r}")

    js_text = (package_dir / "KnightOnLine.js").read_text(encoding="utf-8", errors="replace")
    require("KnightOnLine.wasm" in js_text, "loader does not reference KnightOnLine.wasm")
    require("KnightOnLine.data" in js_text, "loader does not reference KnightOnLine.data")
    require("WebAssembly" in js_text, "loader does not contain WebAssembly bootstrap")

    if args.index:
        index = Path(args.index)
        require(index.is_file(), f"index not found: {index}")
        html = index.read_text(encoding="utf-8")
        lowered = html.lower()
        require('id="canvas"' in lowered or "id='canvas'" in lowered, "index has no game canvas")
        require("KnightOnLine.js" in html, "index does not load KnightOnLine.js")
        require(re.search(r"--renderer[^a-z0-9]+['\"]?gl", html, re.I | re.S) is not None,
                "index does not force the GL renderer")
        require(re.search(r"--data[^a-z0-9/]+['\"]?/data", html, re.I | re.S) is not None,
                "index does not mount/use /data")
        require("webgl2" in lowered, "index has no WebGL2 capability gate")
        require("three.js" not in lowered and "three.min.js" not in lowered and "three.module" not in lowered,
                "Three.js reference found in real-client bootstrap")
        files[index.name] = {"size": index.stat().st_size, "sha256": sha256(index)}

    manifest = {
        "format": 1,
        "package": "OldKOWeb/OldKO 1298 browser client",
        "openko_sha": args.openko_sha,
        "ko_assets_sha": args.assets_sha,
        "emscripten_version": args.emscripten_version,
        "files": files,
    }
    if args.manifest:
        manifest_path = Path(args.manifest)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("PACKAGE_OK")
    for name, meta in files.items():
        print(f"{name}: size={meta['size']} sha256={meta['sha256']}")


if __name__ == "__main__":
    main()
