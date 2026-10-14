#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from gameplay import ProtocolError, decode_frame, parse_frame

ROOT = Path(__file__).resolve().parents[2]
GOOD = ROOT/"protocol-lab"/"gameplay-fixtures"
AUTH = ROOT/"protocol-lab"/"gameplay-authority.json"

def main():
    authority = json.loads(AUTH.read_text(encoding="utf-8"))
    packets = {(p["name"], p["opcode"]):p for p in authority["packets"]}
    manifest = json.loads((GOOD/"manifest.json").read_text(encoding="utf-8"))
    listed = {e["file"] for e in manifest["fixtures"]}
    actual = {p.name for p in GOOD.glob("*.bin")}
    if listed != actual:
        raise SystemExit(f"fixture manifest mismatch listed={sorted(listed)} actual={sorted(actual)}")
    for e in manifest["fixtures"]:
        raw=(GOOD/e["file"]).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=e["sha256"]:
            raise SystemExit(f"sha mismatch: {e['file']}")
        if raw.hex()!=e["frame_hex"]:
            raise SystemExit(f"hex mismatch: {e['file']}")
        parse_frame(raw)
        key=(e["name"],e["opcode"])
        if key not in packets:
            raise SystemExit(f"authority missing {key}")
        d=decode_frame(raw,e["direction"])
        if d["name"]!=e["name"] or d.get("variant")!=e["authority_variant"]:
            raise SystemExit(f"decode/authority mismatch {e['file']}: {d}")
    print(json.dumps({"golden_fixtures":len(listed),"status":"PASS"}))

if __name__=="__main__":
    main()
