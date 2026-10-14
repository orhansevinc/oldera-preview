#!/usr/bin/env python3
import argparse, hashlib, json, shutil
from pathlib import Path

WS38_PIN="683f6d55471d1b101371e5766ecf0ef21c8bf1e9"
ASSET_COMMIT="2055ee6ed77f1b5cfef23832dd5bc31909e14a66"
GROUPS={"BANDICOOT_MODEL","BANDICOOT_ANIMATION","BANDICOOT_PARTS","BANDICOOT_TEXTURES"}

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""): h.update(chunk)
    return h.hexdigest()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--asset-root", default="ko-assets")
    ap.add_argument("--stage-root", default="ws05-bandicoot")
    ap.add_argument("--cmake", default="openko/src/Client/WarFare/CMakeLists.txt")
    ap.add_argument("--proof", default="artifacts/ws05/bandicoot-asset-stage.json")
    a=ap.parse_args()
    m=json.loads(Path(a.manifest).read_text())
    authority=m.get("authority",{})
    if authority.get("genuine_asset_source",{}).get("commit") != ASSET_COMMIT:
        raise SystemExit("WS38 genuine asset commit mismatch")
    entries=[e for e in m.get("entries",[]) if e.get("group") in GROUPS]
    if len(entries) != 14:
        raise SystemExit(f"expected 14 Bandicoot entries, got {len(entries)}")
    stage=Path(a.stage_root)
    if stage.exists(): shutil.rmtree(stage)
    records=[]
    for e in entries:
        if e.get("status")!="SOURCE_VERIFIED": raise SystemExit(f"unverified entry {e.get('logical_id')}")
        if e.get("source_commit")!=ASSET_COMMIT: raise SystemExit(f"asset commit mismatch {e.get('logical_id')}")
        virtual=e.get("packaged_virtual_path","")
        if not (virtual.startswith("/data/chr/") or virtual.startswith("/data/item/")):
            raise SystemExit(f"unexpected virtual path {virtual}")
        requested=e.get("client_requested_path","").replace("\\","/")
        expected=virtual.removeprefix("/data/")
        if requested != expected:
            raise SystemExit(f"requested/virtual case mismatch {requested} != {expected}")
        src=Path(a.asset_root)/e["source_path"]
        if not src.is_file(): raise SystemExit(f"missing exact source asset {src}")
        size=src.stat().st_size; digest=sha256(src)
        if size!=e["size"] or digest!=e["sha256"]:
            raise SystemExit(f"source asset identity mismatch {src}")
        dst=stage/expected
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src,dst)
        if sha256(dst)!=digest: raise SystemExit(f"staged hash mismatch {dst}")
        records.append({"logical_id":e["logical_id"],"source_path":e["source_path"],
            "client_requested_path":e["client_requested_path"],"virtual_path":virtual,
            "sha256":digest,"size":size})
    cmake=Path(a.cmake); s=cmake.read_text()
    marker="# WS05 exact Bandicoot lowercase VFS preload"
    if marker not in s:
        block='''\nif(EMSCRIPTEN)\n  # WS05 exact Bandicoot lowercase VFS preload\n  target_link_options(WarFare PRIVATE\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../STAGE_NAME/chr@/data/chr"\n    "SHELL:--preload-file ${CMAKE_SOURCE_DIR}/../STAGE_NAME/item@/data/item"\n  )\nendif()\n'''.replace("STAGE_NAME", stage.name)
        cmake.write_text(s + block)
    proof={"schema_version":1,"ws38_pin":WS38_PIN,"asset_commit":ASSET_COMMIT,
      "path_policy":{"browser_vfs_case_sensitive":True,"separator_normalization":"backslash_to_forward_slash_only"},
      "entries":records,"result":"PASS"}
    p=Path(a.proof); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(proof,indent=2)+"\n")
    print(f"WS05_BANDICOOT_STAGE PASS entries={len(records)} stage={stage}")

if __name__=="__main__": main()
