#!/usr/bin/env python3
"""WS50: disposable Git merge rehearsal. Never writes to source repo or remotes."""
from __future__ import annotations
import argparse, json, re, shlex, shutil, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path

WS = re.compile(r"^ws(\d{2})-")
SHA = re.compile(r"\b[0-9a-fA-F]{7,40}\b")
WST = re.compile(r"\bWS(\d{2})\b", re.I)
DEP = re.compile(r"depend|requires?|gereksinim|coordinate|integration", re.I)
MANIFEST = {"package.json","package-lock.json","pnpm-lock.yaml","yarn.lock","pyproject.toml","requirements.txt","poetry.lock","Cargo.toml","Cargo.lock","go.mod","go.sum","docker-compose.yml","docker-compose.yaml"}
IFACE = ("schema","contract","interface","migration","proto","openapi")


def run(cwd: Path, *cmd: str, check=True):
    p = subprocess.run(cmd, cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if check and p.returncode:
        raise RuntimeError(f"{shlex.join(cmd)} failed ({p.returncode})\n{p.stderr}")
    return p

def git(cwd: Path, *args: str, check=True): return run(cwd, "git", *args, check=check)
def exists(cwd: Path, ref: str): return git(cwd,"show-ref","--verify","--quiet",ref,check=False).returncode == 0
def resolve(cwd: Path, name: str):
    for r in (f"refs/remotes/origin/{name}",f"refs/heads/{name}"):
        if exists(cwd,r): return r
    return None
def num(branch: str): return int(WS.match(branch).group(1)) if WS.match(branch) else 999
def wid(branch: str): return f"WS{num(branch):02d}"
def show(cwd: Path, ref: str, path: str):
    p=git(cwd,"show",f"{ref}:{path}",check=False); return p.stdout if p.returncode==0 else None

def refs(cwd: Path):
    out={}
    for ns in ("refs/remotes/origin","refs/heads"):
        for r in git(cwd,"for-each-ref","--format=%(refname)",ns).stdout.splitlines():
            b=r.rsplit("/",1)[-1]
            if WS.match(b) and b not in out: out[b]=r
    return out

def ancestor(cwd: Path,a: str,b: str): return git(cwd,"merge-base","--is-ancestor",a,b,check=False).returncode==0

def closing_sha(cwd: Path,text: str,ref: str):
    for line in text.splitlines():
        if "commit" not in line.lower(): continue
        for s in SHA.findall(line):
            if git(cwd,"cat-file","-e",f"{s}^{{commit}}",check=False).returncode==0 and ancestor(cwd,s,ref):
                return git(cwd,"rev-parse",s).stdout.strip()
    return None

def deps(text: str,self_id: str):
    found=set()
    for line in text.splitlines():
        if DEP.search(line):
            found |= {f"WS{m.group(1)}" for m in WST.finditer(line)}
    found.discard(self_id); return found

def files(cwd: Path,base: str,ref: str): return set(git(cwd,"diff","--name-only",f"{base}...{ref}").stdout.splitlines())
def ctype(paths):
    ps=set(paths)
    if any(p.startswith(".github/workflows/") for p in ps): return "workflow path conflict"
    if any(Path(p).name in MANIFEST for p in ps): return "package/dependency conflict"
    if any(any(h in p.lower() for h in IFACE) for p in ps): return "schema/interface conflict"
    return "same-file ownership conflict"

def ws40_order(cwd: Path,all_refs: dict,main_sha: str):
    r=all_refs.get("ws40-release-readiness")
    if not r: return [],"WS40 branch missing"
    if git(cwd,"rev-parse",r).stdout.strip()==main_sha: return [],"WS40 branch identical to main; MERGE_ORDER unavailable"
    tree=git(cwd,"ls-tree","-r","--name-only",r).stdout.splitlines()
    paths=["integration-plans/MERGE_ORDER.md","release/MERGE_ORDER.md","workstreams/ws40/MERGE_ORDER.md"]+[p for p in tree if "MERGE_ORDER" in p.upper()]
    for p in paths:
        t=show(cwd,r,p)
        if t:
            order=[]
            for m in WST.finditer(t):
                x=f"WS{m.group(1)}"
                if x!="WS40" and x not in order: order.append(x)
            if order: return order,f"WS40 read-only plan: {p}"
    return [],"WS40 has no parseable MERGE_ORDER"

def static_checks(cwd: Path,base: str):
    bad=[]
    p=git(cwd,"diff","--check",f"{base}..HEAD",check=False)
    if p.returncode: bad.append("git diff --check: "+(p.stdout+p.stderr).strip())
    for rel in git(cwd,"diff","--name-only",f"{base}..HEAD").stdout.splitlines():
        f=cwd/rel
        if not f.is_file(): continue
        if f.suffix==".json":
            try: json.loads(f.read_text())
            except Exception as e: bad.append(f"invalid JSON {rel}: {e}")
        elif f.suffix==".py":
            q=run(cwd,sys.executable,"-m","py_compile",rel,check=False)
            if q.returncode: bad.append(f"python compile {rel}: {q.stderr.strip()}")
        elif f.suffix in {".js",".cjs",".mjs"} and shutil.which("node"):
            q=run(cwd,"node","--check",rel,check=False)
            if q.returncode: bad.append(f"node --check {rel}: {q.stderr.strip()}")
    return bad

def inside(p: Path,root: Path):
    try: p.resolve().relative_to(root.resolve()); return True
    except ValueError: return False

def safe_batches(results):
    batches=[]
    for r in [x for x in results if x["class"]=="cleanly integratable"]:
        for b in batches:
            occupied=set().union(*(x["files"] for x in b)) if b else set()
            if not (occupied & r["files"]): b.append(r); break
        else: batches.append([r])
    return [[x["ws"] for x in b] for b in batches]

def render(root: Path,results,conflicts,batches,plan,base,bad):
    d=root/"integration-rehearsal"; d.mkdir(parents=True,exist_ok=True)
    (root/"workstreams/ws50").mkdir(parents=True,exist_ok=True)
    counts=defaultdict(int)
    for r in results: counts[r["class"]]+=1
    keys=["cleanly integratable","conflict","blocked dependency","stale branch","missing commit","test failure"]
    lines=["# WS50 Integration Rehearsal Report","",f"- Base: `main` @ `{base}`",f"- Merge order source: {plan}","- Execution: disposable local clone; source checkout and remotes are read-only.","- Validation: real Git merges + diff check + JSON/Python/Node syntax checks.","- Full service dependency install/build/E2E is not universal; overall test status is PARTIAL.","","## Classification summary",""]+[f"- {k}: **{counts[k]}**" for k in keys]
    lines += ["","## Branch results","","| WS | Branch | Class | Head | Merge base | Notes |","|---|---|---|---|---|---|"]
    for r in results:
        note="; ".join(r["notes"]).replace("|","\\|") or "-"
        lines.append(f"| {r['ws']} | `{r['branch']}` | **{r['class']}** | `{r['head'][:12]}` | `{(r.get('merge_base') or '-')[:12]}` | {note} |")
    lines += ["","## Post-merge static validation",""] + ([f"- FAIL: {x}" for x in bad] if bad else ["- PASS on the integrated rehearsal tree."])
    (d/"REHEARSAL_REPORT.md").write_text("\n".join(lines)+"\n")
    s=["# WS50 Safe Batches","","No two WS entries in the same batch touch the same base-relative file.",""]+([f"- Batch {i}: {', '.join(b)}" for i,b in enumerate(batches,1)] or ["- No clean batch."])
    (d/"SAFE_BATCHES.md").write_text("\n".join(s)+"\n")
    failed=[r for r in results if r["class"]!="cleanly integratable"]
    f=["# WS50 Failed / Blocked Branches",""]+([f"- {r['ws']} `{r['branch']}` — **{r['class']}**"+(f": {'; '.join(r['notes'])}" if r['notes'] else "") for r in failed] or ["- None."])
    (d/"FAILED_BRANCHES.md").write_text("\n".join(f)+"\n")
    c=["# WS50 Conflicts",""]
    if not conflicts: c.append("No conflict/ownership overlap detected among rehearsal-eligible WS branches.")
    for x in conflicts:
        c += [f"WS_A: {x['a']}",f"WS_B: {x['b']}",f"FILES: {', '.join(x['files']) or '(none captured)'}",f"CONFLICT_TYPE: {x['type']}",f"SUGGESTED_OWNER: {x['owner']}",f"RECOMMENDED_ORDER: {x['order']}",""]
    (root/"workstreams/ws50/CONFLICTS.md").write_text("\n".join(c)+"\n")

def rehearse(repo: Path,output_root: Path):
    repo,output_root=repo.resolve(),output_root.resolve()
    if inside(output_root,repo): raise ValueError("output-root must be outside source repository")
    head0=git(repo,"rev-parse","HEAD").stdout.strip(); status0=git(repo,"status","--porcelain").stdout
    with tempfile.TemporaryDirectory(prefix="ws50-") as td:
        clone=Path(td)/"repo"; run(repo.parent,"git","clone","--local","--no-hardlinks",str(repo),str(clone))
        git(clone,"config","user.name","WS50 Rehearsal"); git(clone,"config","user.email","ws50@invalid.local")
        src=refs(repo)
        for b,r in src.items(): git(clone,"update-ref",f"refs/heads/{b}",git(repo,"rev-parse",r).stdout.strip())
        mr=resolve(repo,"main")
        if mr: git(clone,"update-ref","refs/heads/main",git(repo,"rev-parse",mr).stdout.strip())
        allr=refs(clone); main=resolve(clone,"main")
        if not main: raise RuntimeError("main ref missing")
        base=git(clone,"rev-parse",main).stdout.strip(); order,plan=ws40_order(clone,allr,base)
        candidates=[b for b in allr if num(b)<=49 and b!="ws50-integration-rehearsal"]
        byid={wid(b):b for b in candidates}; seq=[byid[x] for x in order if x in byid]
        seq += sorted([b for b in candidates if b not in seq],key=lambda b:(num(b),b))
        if not order: plan += "; numeric fallback used"
        results=[]
        for b in seq:
            r=allr[b]; h=git(clone,"rev-parse",r).stdout.strip(); x={"branch":b,"ws":wid(b),"head":h,"files":set(),"deps":set(),"notes":[],"class":""}
            if h==base: x["class"]="stale branch"; x["notes"].append("HEAD identical to main"); results.append(x); continue
            mb=git(clone,"merge-base",main,r,check=False)
            if mb.returncode: x["class"]="stale branch"; x["notes"].append("no merge-base with main"); results.append(x); continue
            x["merge_base"]=mb.stdout.strip(); sp=f"workstreams/ws{num(b):02d}/STATUS.md"; st=show(clone,r,sp)
            if st is None: x["class"]="missing commit"; x["notes"].append(f"missing {sp}"); results.append(x); continue
            close=closing_sha(clone,st,r)
            if not close: x["class"]="missing commit"; x["notes"].append("STATUS has no verifiable repository closing commit SHA"); results.append(x); continue
            x["closing"]=close; x["files"]=files(clone,main,r); x["deps"]=deps(st,x["ws"]); results.append(x)
        byws={x["ws"]:x for x in results}; conflicts=[]; integrated=[]
        git(clone,"checkout","--detach",base); git(clone,"switch","-c","ws50-rehearsal-tmp")
        for x in results:
            if x["class"] in {"stale branch","missing commit"}: continue
            blocked=[d for d in sorted(x["deps"]) if d in byws and byws[d] not in integrated and byws[d]["class"]!="cleanly integratable"]
            if blocked: x["class"]="blocked dependency"; x["notes"].append("unready dependencies: "+", ".join(blocked)); continue
            before=git(clone,"rev-parse","HEAD").stdout.strip(); p=git(clone,"merge","--no-ff","--no-edit",allr[x["branch"]],check=False)
            if p.returncode:
                cf=set(git(clone,"diff","--name-only","--diff-filter=U",check=False).stdout.splitlines()); peers=[y for y in integrated if y["files"] & (cf or x["files"])]; peer=peers[-1] if peers else (integrated[-1] if integrated else None)
                ov=(peer["files"] & x["files"]) if peer else cf; a=peer["ws"] if peer else "MAIN"
                conflicts.append({"a":a,"b":x["ws"],"files":sorted(cf or ov),"type":ctype(cf or ov),"owner":a if peer else x["ws"],"order":f"{a} before {x['ws']}; product owner resolves, WS50 does not"})
                git(clone,"merge","--abort",check=False); git(clone,"reset","--hard",before); x["class"]="conflict"; x["notes"].append("git merge conflict"); continue
            bad=static_checks(clone,main)
            if bad: x["class"]="test failure"; x["notes"]+=bad[:2]; git(clone,"reset","--hard",before); continue
            x["class"]="cleanly integratable"; integrated.append(x)
        # same-file ownership overlaps are reported even if Git auto-merges
        for i,a in enumerate(integrated):
            for b in integrated[i+1:]:
                ov=a["files"] & b["files"]
                if ov: conflicts.append({"a":a["ws"],"b":b["ws"],"files":sorted(ov),"type":ctype(ov)+" (auto-merge/ownership overlap)","owner":a["ws"],"order":f"{a['ws']} before {b['ws']}; review shared ownership"})
        bad=static_checks(clone,main); batches=safe_batches(results); render(output_root,results,conflicts,batches,plan,base,bad)
    if git(repo,"rev-parse","HEAD").stdout.strip()!=head0 or git(repo,"status","--porcelain").stdout!=status0: raise RuntimeError("source checkout changed")
    return results,conflicts,batches,bad,plan,base

def main():
    ap=argparse.ArgumentParser(); ap.add_argument("--repo",default="."); ap.add_argument("--output-root",default=None); a=ap.parse_args()
    repo=Path(a.repo); root=Path(a.output_root).resolve() if a.output_root else repo.resolve().parent/"ws50-rehearsal-output"
    r,c,b,bad,plan,base=rehearse(repo,root); n=defaultdict(int)
    for x in r: n[x["class"]]+=1
    s={"base":base,"plan_source":plan,"cleanly_integratable":n["cleanly integratable"],"conflict":n["conflict"],"blocked_dependency":n["blocked dependency"],"stale_branch":n["stale branch"],"missing_commit":n["missing commit"],"test_failure":n["test failure"],"safe_batches":len(b),"conflict_records":len(c),"post_merge_static_failures":len(bad)}
    print("WS50_SUMMARY="+json.dumps(s,sort_keys=True)); return 0 if not bad else 2
if __name__=="__main__": raise SystemExit(main())
