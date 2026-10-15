#!/usr/bin/env python3
"""Build explicit OpenKO VFS packs without guessing missing assets.

The plan is authoritative: every virtual path must already exist under --asset-root
with exact case. The tool never substitutes a placeholder/black model and never
rewrites generated KnightOnLine JS/WASM binaries.
"""
from __future__ import annotations
import argparse, hashlib, json, os, pathlib, subprocess, sys


def sha256(path: pathlib.Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def exact_path(root: pathlib.Path, virtual: str) -> pathlib.Path:
    if not virtual.startswith('/data/'):
        raise ValueError(f'virtual path must start /data/: {virtual}')
    rel=virtual[len('/data/'):]
    cur=root
    for part in pathlib.PurePosixPath(rel).parts:
        names={p.name:p for p in cur.iterdir()}
        if part not in names:
            folded=[n for n in names if n.casefold()==part.casefold()]
            if folded:
                raise FileNotFoundError(f'case mismatch: requested {part!r}, actual {folded[0]!r} under {cur}')
            raise FileNotFoundError(f'missing required asset: {virtual}')
        cur=names[part]
    if not cur.is_file(): raise FileNotFoundError(f'not a file: {virtual}')
    return cur


def main() -> int:
    ap=argparse.ArgumentParser()
    ap.add_argument('--asset-root',required=True,help='Directory mounted as /data')
    ap.add_argument('--plan',required=True)
    ap.add_argument('--file-packager',required=True,help='Emscripten file_packager.py')
    ap.add_argument('--out',required=True)
    ap.add_argument('--execute',action='store_true')
    args=ap.parse_args()
    root=pathlib.Path(args.asset_root).resolve(); out=pathlib.Path(args.out).resolve(); out.mkdir(parents=True,exist_ok=True)
    plan=json.loads(pathlib.Path(args.plan).read_text(encoding='utf-8'))
    if plan.get('schema')!='oldkoweb/p2-02-asset-pack-plan/v1': raise SystemExit('unsupported plan schema')
    if plan.get('blocked_required_groups'):
        raise SystemExit('plan has unresolved required groups: '+','.join(plan['blocked_required_groups']))
    report={'schema':'oldkoweb/p2-02-asset-pack-build/v1','packs':[]}
    for pack in plan.get('packs',[]):
        name=pack['name']; paths=pack.get('virtual_paths',[])
        if not paths: raise SystemExit(f'empty pack forbidden: {name}')
        resolved=[]
        for virtual in paths:
            src=exact_path(root,virtual)
            resolved.append({'virtual_path':virtual,'source':str(src),'bytes':src.stat().st_size,'sha256':sha256(src)})
        data=out/f'{name}.data'; js=out/f'{name}.preload.js'
        cmd=[sys.executable,str(pathlib.Path(args.file_packager).resolve()),str(data),f'--js-output={js}','--no-node']
        for item in resolved: cmd.extend(['--preload',f"{item['source']}@{item['virtual_path']}"])
        if args.execute:
            subprocess.run(cmd,check=True)
            if not data.is_file() or not js.is_file(): raise SystemExit(f'file_packager did not create {name}')
        report['packs'].append({'name':name,'startup':bool(pack.get('startup')),'files':resolved,'command':cmd,'executed':args.execute})
    (out/'pack-build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'packs':len(report['packs']),'executed':args.execute,'report':str(out/'pack-build.json')}))
    return 0

if __name__=='__main__':
    raise SystemExit(main())
