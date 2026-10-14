#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
AUTH=ROOT/"protocol-lab"/"gameplay-authority.json"
OWNERS=ROOT/"protocol-lab"/"PROTOCOL_OWNER_MATRIX.json"
SOURCES=ROOT/"protocol-lab"/"source-manifest.json"
ALLOWED_CONFIDENCE={"VERIFIED","PARTIAL","UNKNOWN"}
ALLOWED_DIR={"C2S","S2C","BOTH","UNKNOWN"}

def die(msg): raise SystemExit(f"WS11 authority validation failed: {msg}")

def main():
    a=json.loads(AUTH.read_text(encoding="utf-8"))
    owners=json.loads(OWNERS.read_text(encoding="utf-8"))
    sources=json.loads(SOURCES.read_text(encoding="utf-8"))
    if not sources.get("authoritative"): die("source manifest has no authoritative sources")
    seen=set(); verified=partial=full=0
    for p in a.get("packets",[]):
        for k in ("name","opcode","direction","confidence","variants"):
            if k not in p: die(f"packet missing {k}")
        if p["confidence"] not in ALLOWED_CONFIDENCE: die(f"{p['name']}: bad confidence")
        if p["direction"] not in ALLOWED_DIR: die(f"{p['name']}: bad direction")
        op=int(p["opcode"],0)
        if not 0<=op<=255: die(f"{p['name']}: opcode out of range")
        key=(p["name"],p["opcode"])
        if key in seen: die(f"duplicate {key}")
        seen.add(key)
        if p["confidence"]=="VERIFIED":
            verified+=1
            if not p["variants"]: die(f"{p['name']}: VERIFIED without variant")
        elif p["confidence"]=="PARTIAL": partial+=1
        for v in p["variants"]:
            if v.get("direction") not in {"C2S","S2C"}: die(f"{p['name']}/{v.get('id')}: bad direction")
            fields=v.get("fields")
            if not isinstance(fields,list) or not fields: die(f"{p['name']}/{v.get('id')}: empty fields")
            for f in fields:
                if not isinstance(f.get("offset"),int) or f["offset"]<0: die(f"{p['name']}/{v['id']}: bad offset")
                if "field" not in f or "type" not in f: die(f"{p['name']}/{v['id']}: malformed field")
            if isinstance(v.get("payload_bytes"),int) and all("UNKNOWN" not in str(f["type"]) and "[" not in str(f["type"]) for f in fields):
                full+=1
    rows=owners.get("matrix",[])
    critical={("0x1D","WIZ_REQ_NPCIN"),("0x1F","WIZ_ITEM_MOVE"),("0x08","WIZ_ATTACK"),("0x31","WIZ_MAGIC_PROCESS")}
    keys={(r["opcode"],r["name"]) for r in rows}
    if not critical.issubset(keys): die(f"owner matrix missing {critical-keys}")
    coll=next(r for r in rows if r["opcode"]=="0x1D")
    if coll.get("status")!="COLLISION_RESOLVED": die("0x1D collision not resolved")
    print(json.dumps({"packet_rows":len(a["packets"]),"verified_packets":verified,"partial_packets":partial,"fully_specified_fixed_variants":full,"owner_rows":len(rows)},sort_keys=True))
if __name__=="__main__": main()
