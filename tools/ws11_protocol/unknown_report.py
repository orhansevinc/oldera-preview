#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
a=json.loads((ROOT/"protocol-lab"/"gameplay-authority.json").read_text(encoding="utf-8"))
unknown=[]
for p in a["packets"]:
    if p["confidence"]!="VERIFIED" or not p.get("variants"):
        unknown.append({"opcode":p["opcode"],"name":p["name"],"confidence":p["confidence"],"notes":p.get("notes","")})
print(json.dumps({"unknown_or_partial_count":len(unknown),"packets":unknown}, indent=2))
