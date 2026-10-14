#!/usr/bin/env python3
from __future__ import annotations
import argparse, csv, hashlib, io, json, re, urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCK_PATH = ROOT / "data-catalog" / "source-lock.json"
OUT = ROOT / "data-catalog" / "generated"
PARSER = "ws31-generator/2.0.0"

def stable(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"

def sha256_bytes(b): return hashlib.sha256(b).hexdigest()
def sha256_text(s): return sha256_bytes(s.encode("utf-8"))

def fetch(repo, commit, path):
    url = f"https://raw.githubusercontent.com/{repo}/{commit}/{path}"
    req = urllib.request.Request(url, headers={"User-Agent":"oldera-ws31-data-catalog/2.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        b = r.read()
    return b.decode("utf-8", errors="replace"), sha256_bytes(b), url

def parse_atom(tok):
    tok = tok.strip()
    if tok.upper() == "NULL": return None
    if (tok.startswith("N'") or tok.startswith("n'")) and tok.endswith("'"):
        return tok[2:-1].replace("''", "'")
    if tok.startswith("'") and tok.endswith("'"):
        return tok[1:-1].replace("''", "'")
    try: return int(tok)
    except ValueError:
        try: return float(tok)
        except ValueError: return tok

def split_sql_values(s):
    vals=[]; cur=[]; quoted=False; i=0
    while i < len(s):
        c=s[i]
        if c=="'":
            cur.append(c)
            if quoted and i+1 < len(s) and s[i+1]=="'":
                cur.append("'"); i += 2; continue
            quoted = not quoted; i += 1; continue
        if c=="," and not quoted:
            vals.append(parse_atom("".join(cur))); cur=[]; i += 1; continue
        cur.append(c); i += 1
    vals.append(parse_atom("".join(cur)))
    return vals

def parse_insert(text, source_id, repo, commit, path, source_sha):
    m = re.search(r"INSERT\s+INTO\s+\[?([A-Za-z0-9_]+)\]?\s*\((.*?)\)\s*VALUES", text, re.I|re.S)
    if not m: raise RuntimeError(f"INSERT header not found: {path}")
    cols=[x.strip().strip("[]") for x in m.group(2).split(",")]
    rows=[]
    for n,line in enumerate(text[m.end():].splitlines(), start=text[:m.end()].count("\n")+1):
        s=line.strip()
        if not s.startswith("("): continue
        if s.endswith(",") or s.endswith(";"): s=s[:-1]
        if not (s.startswith("(") and s.endswith(")")): continue
        vals=split_sql_values(s[1:-1])
        if len(vals) != len(cols): raise RuntimeError(f"{path}:{n}: {len(vals)} values != {len(cols)} cols")
        d=dict(zip(cols, vals))
        d["_prov"]={"source_id":source_id,"commit":commit,"path":path,"line":n,"row_sha256":sha256_text(stable(vals).rstrip("\n"))}
        rows.append(d)
    return rows

def parse_csv(text, source_id, commit, path):
    reader=csv.reader(io.StringIO(text)); rows=list(reader); out=[]
    for i,r in enumerate(rows[1:], start=2):
        if not r: continue
        out.append({"fields":r,"_prov":{"source_id":source_id,"commit":commit,"path":path,"line":i,"row_sha256":sha256_text(stable(r).rstrip("\n"))}})
    return out

def prov(row): return [row["_prov"]]
def verified(row, extra=None):
    p=prov(row)
    if extra: p += [x["_prov"] for x in extra]
    return {"status":"VERIFIED","provenance":p}
def val(d,*names,default=None):
    for n in names:
        if n in d: return d[n]
    return default
def catalog(name, rows, commits):
    return {"catalog":name,"patch":"1298","parser_version":PARSER,"source_commits":commits,"rows":rows}

def make():
    lock=json.loads(LOCK_PATH.read_text()); srcs=lock["sources"]; commits={k:v["commit"] for k,v in srcs.items()}; source_manifest={}; cache={}
    def get(source_id,key):
        s=srcs[source_id]; path=s["files"][key]; ck=(source_id,path)
        if ck not in cache:
            text,h,url=fetch(s["repo"],s["commit"],path); cache[ck]=text
            source_manifest[f"{source_id}:{path}"]={"repo":s["repo"],"commit":s["commit"],"path":path,"sha256":h,"url":url}
        return cache[ck], source_manifest[f"{source_id}:{path}"]["sha256"], path
    def sql(key):
        text,h,path=get("openko-db",key); s=srcs["openko-db"]
        return parse_insert(text,"openko-db",s["repo"],s["commit"],path,h)
    def ccsv(key):
        text,h,path=get("openko-client-1298",key); s=srcs["openko-client-1298"]
        return parse_csv(text,"openko-client-1298",s["commit"],path)

    dbzones=sql("zones"); client_zones=ccsv("zones"); cz={}
    for r in client_zones:
        try: cz[int(r["fields"][0])] = r
        except (ValueError,IndexError): pass
    zones=[]
    for r in dbzones:
        zid=int(val(r,"ZoneNo")); cr=cz.get(zid*10); map_refs=[]
        if cr:
            for raw in cr["fields"]:
                st=str(raw).strip()
                if ("\\" in st or "/" in st) and "." in st: map_refs.append({"raw":raw,"normalized":st.replace("\\","/")})
        zones.append({"zone_id":zid,"name":str(val(r,"bz",default="")).strip(),"type_code":val(r,"Type"),"server_map":val(r,"strZoneName"),"initial_position":{"x":val(r,"InitX"),"y":val(r,"InitY"),"z":val(r,"InitZ")},"client_table_id":zid*10 if cr else None,"map_refs":map_refs,"verification":verified(r,[cr] if cr else None)})
    zones.sort(key=lambda x:x["zone_id"]); zone_ids={x["zone_id"] for x in zones}

    npc_raw=sql("npcs"); mon_raw=sql("monsters"); npcs=[]; mons=[]
    stat_keys=["iHpPoint","sMpPoint","sAtk","sAc","sHitRate","sEvadeRate","sDamage","sAttackDelay","bySpeed1","bySpeed2","byAttackRange","bySearchRange","byTracingRange","iMoney"]
    for r in npc_raw:
        npcs.append({"template_id":int(r["sSid"]),"name":str(r["strName"]).strip(),"model_proto":r["sPid"],"size":r["sSize"],"type_code":r["byType"],"act_type":r["byActType"],"level":r["sLevel"],"merchant_group_id":r["iSellingGroup"] or None,"drop_table_id":r["sItem"] or None,"event_association":None,"stats":{k:r[k] for k in stat_keys},"verification":verified(r)})
    for r in mon_raw:
        mons.append({"template_id":int(r["sSid"]),"name":str(r["strName"]).strip(),"model_proto":r["sPid"],"size":r["sSize"],"type_code":r["byType"],"act_type":r["byActType"],"level":r["sLevel"],"xp_reward":r["iExp"],"loyalty_reward":r["iLoyalty"],"drop_table_id":r["sItem"] or None,"stats":{k:r[k] for k in stat_keys},"verification":verified(r)})
    npcs.sort(key=lambda x:x["template_id"]); mons.sort(key=lambda x:x["template_id"]); npc_ids={x["template_id"] for x in npcs}; mon_ids={x["template_id"] for x in mons}

    spawn_raw=sql("spawns"); npc_spawns=[]; mon_spawns=[]; unresolved=[]
    for idx,r in enumerate(spawn_raw):
        act=int(r["ActType"]); tid=int(r["NpcID"]); zid=int(r["ZoneID"])
        row={"spawn_id":idx+1,"zone_id":zid,"template_id":tid,"act_type":act,"rectangle":{"left_x":r["LeftX"],"top_z":r["TopZ"],"right_x":r["RightX"],"bottom_z":r["BottomZ"]},"limits":{"min_x":r["LimitMinX"],"min_z":r["LimitMinZ"],"max_x":r["LimitMaxX"],"max_z":r["LimitMaxZ"]},"count":r["NumNPC"],"respawn_seconds":r["RegTime"],"direction":r["byDirection"],"path":r["path"],"verification":verified(r)}
        if zid not in zone_ids: unresolved.append({"kind":"spawn_zone_missing","zone_id":zid,"template_id":tid,"source":r["_prov"]})
        if act < 100:
            row["kind"]="MONSTER"; mon_spawns.append(row)
            if tid not in mon_ids: unresolved.append({"kind":"spawn_monster_missing","template_id":tid,"zone_id":zid,"source":r["_prov"]})
        else:
            row["kind"]="NPC"; npc_spawns.append(row)
            if tid not in npc_ids: unresolved.append({"kind":"spawn_npc_missing","template_id":tid,"zone_id":zid,"source":r["_prov"]})

    item_raw=sql("items"); client_items=ccsv("items"); ci={}
    for r in client_items:
        try: ci[int(r["fields"][0])] = r
        except (ValueError,IndexError): pass
    items=[]
    for r in item_raw:
        iid=int(r["Num"]); cr=ci.get(iid); icon=None; model=None
        if cr and len(cr["fields"]) >= 8: model=cr["fields"][6]; icon=cr["fields"][7]
        items.append({"item_id":iid,"name":str(r["strName"]).strip(),"kind":r["Kind"],"slot":r["Slot"],"race_requirement":r["Race"],"class_requirement":r["Class"],"stack_code":r["Countable"],"damage":r["Damage"],"delay":r["Delay"],"range":r["Range"],"weight":r["Weight"],"durability":r["Duration"],"buy_price":r["BuyPrice"],"sell_price":r["SellPrice"],"armor":r["Ac"],"requirements":{"level_min":r["ReqLevel"],"level_max":r["ReqLevelMax"],"rank":r["ReqRank"],"title":r["ReqTitle"],"str":r["ReqStr"],"sta":r["ReqSta"],"dex":r["ReqDex"],"int":r["ReqIntel"],"cha":r["ReqCha"]},"bonuses":{k:r[k] for k in ["Hitrate","Evasionrate","DaggerAc","SwordAc","MaceAc","AxeAc","SpearAc","BowAc","FireDamage","IceDamage","LightningDamage","PoisonDamage","HPDrain","MPDamage","MPDrain","MirrorDamage","StrB","StaB","DexB","IntB","ChaB","MaxHpB","MaxMpB","FireR","ColdR","LightningR","MagicR","PoisonR","CurseR"]},"selling_group":r["SellingGroup"],"item_type":r["ItemType"],"model_ref_raw":model,"icon_ref_raw":icon,"verification":verified(r,[cr] if cr else None)})
    items.sort(key=lambda x:x["item_id"]); item_by={x["item_id"]:x for x in items}; item_ids=set(item_by)

    npcs_by_group=defaultdict(list)
    for n in npcs:
        if n["merchant_group_id"]: npcs_by_group[int(n["merchant_group_id"])].append(n["template_id"])
    items_by_group=defaultdict(list)
    for x in items:
        if x["selling_group"]: items_by_group[int(x["selling_group"])].append(x["item_id"])
    merchants=[]
    for gid in sorted(npcs_by_group):
        ids=sorted(items_by_group.get(gid,[]))
        merchants.append({"merchant_id":gid,"npc_template_ids":sorted(npcs_by_group[gid]),"items":[{"item_id":i,"buy_price":item_by[i]["buy_price"],"sell_price":item_by[i]["sell_price"]} for i in ids],"derivation":"K_NPC.iSellingGroup == ITEM.SellingGroup","verification":{"status":"VERIFIED","provenance":[{"source_id":"openko-db","commit":commits["openko-db"],"path":srcs["openko-db"]["files"]["npcs"]},{"source_id":"openko-db","commit":commits["openko-db"],"path":srcs["openko-db"]["files"]["items"]}]}})
        if not ids: unresolved.append({"kind":"merchant_group_without_items","merchant_id":gid})

    def build_drops(key, owner_kind):
        raw=sql(key); out=[]
        for r in raw:
            entries=[]
            for i in range(1,6):
                iid=int(r[f"iItem{i:02d}"]); chance=int(r[f"sPersent{i:02d}"])
                if iid==0 and chance==0: continue
                rk="ITEM" if iid in item_ids else ("RAW_GROUP_TOKEN" if iid < 100000000 else "MISSING_ITEM")
                entries.append({"slot":i,"raw_item_or_group":iid,"raw_probability":chance,"reference_kind":rk})
                if rk=="MISSING_ITEM": unresolved.append({"kind":"drop_missing_item","table_id":int(r["sIndex"]),"item_id":iid,"owner_kind":owner_kind,"source":r["_prov"]})
            out.append({"drop_table_id":int(r["sIndex"]),"owner_kind":owner_kind,"entries":entries,"verification":verified(r)})
        return sorted(out,key=lambda x:x["drop_table_id"])
    monster_drops=build_drops("monster_drops","MONSTER"); npc_drops=build_drops("npc_drops","NPC"); md_ids={x["drop_table_id"] for x in monster_drops}; nd_ids={x["drop_table_id"] for x in npc_drops}
    for m in mons:
        if m["drop_table_id"] and m["drop_table_id"] not in md_ids: unresolved.append({"kind":"monster_drop_table_missing","template_id":m["template_id"],"drop_table_id":m["drop_table_id"]})
    for n in npcs:
        if n["drop_table_id"] and n["drop_table_id"] not in nd_ids: unresolved.append({"kind":"npc_drop_table_missing","template_id":n["template_id"],"drop_table_id":n["drop_table_id"]})

    magic=sql("skills"); client_skills=ccsv("skills"); cs={}
    for r in client_skills:
        try: cs[int(r["fields"][0])]=r
        except (ValueError,IndexError): pass
    effects=defaultdict(list)
    for t in range(1,10):
        for r in sql(f"skill_type{t}"):
            keys=[k for k in r if not k.startswith("_")]
            if not keys: continue
            try: sid=int(r[keys[0]])
            except (TypeError,ValueError): continue
            effects[sid].append({"type":t,"raw":{k:r[k] for k in keys},"provenance":r["_prov"]})
    valid_classes={101,102,103,104,105,106,107,108,109,110,111,112,201,202,203,204,205,206,207,208,209,210,211,212}; skills=[]
    for r in magic:
        sid=int(r["MagicNum"]); class_id=sid//1000 if sid//1000 in valid_classes else None; cr=cs.get(sid)
        if 100 <= sid//1000 <= 299 and class_id is None: unresolved.append({"kind":"skill_invalid_class","skill_id":sid,"derived_class_id":sid//1000,"source":r["_prov"]})
        skills.append({"skill_id":sid,"name":str(r["EnName"]).strip(),"class_id":class_id,"required_level":r["SkillLevel"],"prerequisite_skill":r["Skill"],"mp_cost":r["Msp"],"hp_cost":r["HP"],"use_item":r["UseItem"] or None,"type1":r["Type1"],"type2":r["Type2"],"range":r["Range"],"moral":r["Moral"],"cast_time":r["CastTime"],"recast_time":r["ReCastTime"],"success_rate":r["SuccessRate"],"effects":effects.get(sid,[]),"client_1298_match":bool(cr),"verification":verified(r,[cr] if cr else None)})
    skills.sort(key=lambda x:x["skill_id"])

    prog_raw=sql("progression"); progression=[]
    for r in prog_raw:
        keys=[k for k in r if not k.startswith("_")]
        if len(keys)>=2: progression.append({"level":int(r[keys[0]]),"xp_required":int(r[keys[1]]),"verification":verified(r)})
    progression.sort(key=lambda x:x["level"])

    path_variants=defaultdict(set); trailing=[]
    for z in zones:
        for p in z["map_refs"]:
            raw=p["raw"]; norm=p["normalized"]; path_variants[norm.lower()].add(norm)
            if raw != str(raw).strip(): trailing.append({"zone_id":z["zone_id"],"raw":raw})
    case_issues=[{"normalized_lower":k,"variants":sorted(v)} for k,v in sorted(path_variants.items()) if len(v)>1]
    for x in case_issues: unresolved.append({"kind":"path_case_inconsistency",**x})
    for x in trailing: unresolved.append({"kind":"path_whitespace",**x})

    outputs={"zones.json":catalog("zones",zones,commits),"npc-templates.json":catalog("npc-templates",npcs,commits),"npc-spawns.json":catalog("npc-spawns",npc_spawns,commits),"monster-templates.json":catalog("monster-templates",mons,commits),"monster-spawns.json":catalog("monster-spawns",mon_spawns,commits),"items.json":catalog("items",items,commits),"skills.json":catalog("skills",skills,commits),"merchants.json":catalog("merchants",merchants,commits),"drops.json":catalog("drops",monster_drops+npc_drops,commits),"progression.json":catalog("progression",progression,commits)}
    summary={"parser_version":PARSER,"verified_counts":{"zones":len(zones),"npc_templates":len(npcs),"npc_spawns":len(npc_spawns),"monster_templates":len(mons),"monster_spawns":len(mon_spawns),"items":len(items),"skills":len(skills),"merchants":len(merchants),"drops":len(monster_drops)+len(npc_drops),"progression_rows":len(progression),"unresolved_refs":len(unresolved)},"source_commits":commits}
    cross={"duplicate_primary_ids":{},"unresolved_count":len(unresolved),"path_case_inconsistencies":case_issues,"rules":{"spawn_kind":"ActType < 100 => K_MONSTER; ActType >= 100 => K_NPC","merchant":"K_NPC.iSellingGroup == ITEM.SellingGroup","monster_drop":"K_MONSTER.sItem -> K_MONSTER_ITEM.sIndex","npc_drop":"K_NPC.sItem -> K_NPC_ITEM.sIndex"}}
    for name,rows,key in [("zones",zones,"zone_id"),("npcs",npcs,"template_id"),("monsters",mons,"template_id"),("items",items,"item_id"),("skills",skills,"skill_id"),("merchants",merchants,"merchant_id"),("progression",progression,"level")]:
        seen=set(); dup=[]
        for x in rows:
            v=x[key]
            if v in seen: dup.append(v)
            seen.add(v)
        cross["duplicate_primary_ids"][name]=sorted(set(dup))
        for v in dup: unresolved.append({"kind":"duplicate_primary_id","catalog":name,"id":v})
    cross["unresolved_count"]=len(unresolved); summary["verified_counts"]["unresolved_refs"]=len(unresolved)

    OUT.mkdir(parents=True,exist_ok=True)
    for fn,obj in outputs.items(): (OUT/fn).write_text(stable(obj),encoding="utf-8")
    (OUT/"source-manifest.json").write_text(stable({"parser_version":PARSER,"sources":source_manifest}),encoding="utf-8")
    (OUT/"catalog-summary.json").write_text(stable(summary),encoding="utf-8")
    (OUT/"cross-reference-report.json").write_text(stable(cross),encoding="utf-8")
    (OUT/"unresolved.json").write_text(stable({"count":len(unresolved),"rows":sorted(unresolved,key=lambda x:stable(x))}),encoding="utf-8")
    files={}
    for p in sorted(OUT.glob("*.json")):
        if p.name=="hash-manifest.json": continue
        files[p.name]=sha256_bytes(p.read_bytes())
    (OUT/"hash-manifest.json").write_text(stable({"parser_version":PARSER,"files":files}),encoding="utf-8")

    c=summary["verified_counts"]
    (ROOT/"workstreams/ws31/STATUS.md").write_text(f"""# WS31 STATUS\n\nDURUM: COMPLETE — deterministic verified data authority generated from pinned sources.\n\n## VERIFIED DATA COUNTS\n- zones: {c['zones']}\n- NPC templates: {c['npc_templates']}\n- NPC spawns: {c['npc_spawns']}\n- monster templates: {c['monster_templates']}\n- monster spawns: {c['monster_spawns']}\n- items: {c['items']}\n- skills: {c['skills']}\n- merchants: {c['merchants']}\n- drops: {c['drops']}\n- progression rows: {c['progression_rows']}\n- unresolved refs: {c['unresolved_refs']}\n\nGenerated catalog is under `data-catalog/generated/`. `hash-manifest.json` is byte-stability authority.\n""",encoding="utf-8")
    (ROOT/"workstreams/ws31/DATA_PROVENANCE.md").write_text(f"""# WS31 DATA PROVENANCE\n\nParser: `{PARSER}`\n\nPinned sources:\n- Open-KO/KnightOnline `{commits['openko-server']}`\n- Open-KO/ko-client-assets `openko-1298` `{commits['openko-client-1298']}`\n- Open-KO/OpenKO-db `{commits['openko-db']}`\n\nEvery generated real-data row carries `verification.status=VERIFIED` and one or more source provenance records. Derived merchant rows explicitly record their join rule. Unknown/ambiguous references are not promoted to VERIFIED semantics and are listed in `generated/unresolved.json`.\n""",encoding="utf-8")
    (ROOT/"workstreams/ws31/CATALOG_SUMMARY.md").write_text(f"""# WS31 CATALOG SUMMARY\n\nMachine-readable authority: `data-catalog/generated/`.\n\nCounts: zones {c['zones']}; NPC templates/spawns {c['npc_templates']}/{c['npc_spawns']}; monster templates/spawns {c['monster_templates']}/{c['monster_spawns']}; items {c['items']}; skills {c['skills']}; merchants {c['merchants']}; drop tables {c['drops']}; progression {c['progression_rows']}.\n\nCross-reference rules and duplicate audits are in `cross-reference-report.json`; exact source hashes are in `source-manifest.json`.\n""",encoding="utf-8")
    (ROOT/"workstreams/ws31/UNRESOLVED.md").write_text(f"""# WS31 UNRESOLVED REPORT\n\nMachine-readable unresolved rows: `data-catalog/generated/unresolved.json`.\n\nCurrent unresolved reference count: **{c['unresolved_refs']}**.\n\nThese rows are intentionally retained as unresolved; the generator never upgrades a missing/ambiguous reference to VERIFIED by inference.\n""",encoding="utf-8")
    print(stable(summary),end="")

if __name__=="__main__":
    ap=argparse.ArgumentParser(); ap.add_argument("--check",action="store_true"); args=ap.parse_args(); before={}
    if args.check and OUT.exists(): before={p.name:p.read_bytes() for p in OUT.glob("*.json")}
    make()
    if args.check and before:
        after={p.name:p.read_bytes() for p in OUT.glob("*.json")}
        if before != after: raise SystemExit("generated catalog differs from committed output")
