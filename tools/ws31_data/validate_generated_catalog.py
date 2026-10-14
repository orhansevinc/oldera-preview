#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"data-catalog/generated"
REQUIRED={
 "zones.json":"zone_id","npc-templates.json":"template_id","npc-spawns.json":"spawn_id",
 "monster-templates.json":"template_id","monster-spawns.json":"spawn_id","items.json":"item_id",
 "skills.json":"skill_id","merchants.json":"merchant_id","drops.json":"drop_table_id","progression.json":"level"
}
def load(name):
    p=OUT/name
    if not p.exists(): raise SystemExit(f"missing generated file: {name}")
    return json.loads(p.read_text(encoding="utf-8"))
def main():
    errors=[]
    for fn,key in REQUIRED.items():
        d=load(fn)
        if d.get("parser_version")!="ws31-generator/2.0.0": errors.append(f"{fn}: parser_version")
        if not isinstance(d.get("rows"),list): errors.append(f"{fn}: rows")
        seen=set()
        for i,row in enumerate(d.get("rows",[])):
            if key not in row: errors.append(f"{fn}[{i}]: missing {key}"); continue
            pk=(row.get("owner_kind"),row[key]) if fn=="drops.json" else row[key]
            if pk in seen: errors.append(f"{fn}: duplicate primary key {pk}")
            seen.add(pk)
            v=row.get("verification")
            if not isinstance(v,dict) or v.get("status")!="VERIFIED": errors.append(f"{fn}[{i}]: not VERIFIED")
            if not v or not isinstance(v.get("provenance"),list) or not v["provenance"]:
                errors.append(f"{fn}[{i}]: missing provenance")
            else:
                for p in v["provenance"]:
                    for req in ("source_id","commit","path"):
                        if not p.get(req): errors.append(f"{fn}[{i}]: provenance missing {req}")
    summary=load("catalog-summary.json")
    unresolved=load("unresolved.json")
    if summary["verified_counts"]["unresolved_refs"] != unresolved["count"]:
        errors.append("summary unresolved count mismatch")
    cross=load("cross-reference-report.json")
    if any(cross.get("duplicate_primary_ids",{}).values()): errors.append("cross-reference duplicate primary IDs")
    manifest=load("hash-manifest.json")
    for fn,want in manifest["files"].items():
        got=hashlib.sha256((OUT/fn).read_bytes()).hexdigest()
        if got!=want: errors.append(f"hash mismatch: {fn}")
    items={x["item_id"] for x in load("items.json")["rows"]}
    npcs={x["template_id"] for x in load("npc-templates.json")["rows"]}
    mons={x["template_id"] for x in load("monster-templates.json")["rows"]}
    zones={x["zone_id"] for x in load("zones.json")["rows"]}
    for fn,ids in (("npc-spawns.json",npcs),("monster-spawns.json",mons)):
        for r in load(fn)["rows"]:
            if r["template_id"] not in ids: errors.append(f"{fn}: dangling template {r['template_id']}")
            if r["zone_id"] not in zones: errors.append(f"{fn}: missing zone {r['zone_id']}")
    for m in load("merchants.json")["rows"]:
        for x in m["items"]:
            if x["item_id"] not in items: errors.append(f"merchant missing item {x['item_id']}")
        for nid in m["npc_template_ids"]:
            if nid not in npcs: errors.append(f"merchant missing NPC {nid}")
    for d in load("drops.json")["rows"]:
        for e in d["entries"]:
            if e["reference_kind"]=="ITEM" and e["raw_item_or_group"] not in items:
                errors.append(f"drop missing item {e['raw_item_or_group']}")
    if errors:
        print("\n".join(errors[:200])); raise SystemExit(1)
    print("WS31 generated catalog validation: PASS")
if __name__=="__main__": main()
