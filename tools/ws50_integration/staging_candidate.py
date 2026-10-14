#!/usr/bin/env python3
"""WS50 Moradon staging-candidate rehearsal.

Creates a disposable tree from exact provider SHAs, applies only the provider-owned
paths needed by the Moradon test-link candidate, runs service/static/container
checks, and records the known public-staging transport compatibility result.

It never updates main or provider refs.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]

FROZEN = {
    "MAIN": ("main", "3aeaaa3de81c8094b47de44f2c24f3c455e7fd3d"),
    "BROWSER_BASELINE": ("openko-browser-port", "18282d0e70de7ccb30244a9f09e2b3bff3040155"),
    "WS01": ("ws01-runtime-build", "5545df2273cda795055a611618c91b948063624f"),
    "WS02": ("ws02-websocket-gateway", "1738f60945b24e00bdd2266e6600b5c0cf3c64cf"),
    "WS03": ("ws03-ko1298-session", "d634870bbcd2c541695516643d34e0ac119354d7"),
    "WS04": ("ws04-character-client", "fffbd9372b67c2aaef600f7e50595bec7e23fe88"),
    "WS05": ("ws05-moradon-world", "6ca101f3390e0a0f6b056afea99b45ec8d4f67be"),
    "WS09": ("ws09-production-infra", "afca7e7e578a81b8b5852f8a1b3d15a233348847"),
    "WS10": ("ws10-qa-integration", "34c551518aad87a9fd03d392f193d354483c95a0"),
    "WS12": ("ws12-browser-launcher", "e21f84e481203130522964a45e133b84038d8e17"),
    "WS14": ("ws14-world-session", "82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b"),
    "WS38": ("ws38-client-content-pipeline", "5f323f3cf055ba7f96d928605a2f2faf84e609cb"),
}

EXTERNAL = {
    "OPENKO": "97eb0ea20207afc0c360bfed6915113572711be3",
    "KO_ASSETS": "2055ee6ed77f1b5cfef23832dd5bc31909e14a66",
    "EMSCRIPTEN": "6.0.12",
}

PATHS = {
    "BROWSER_BASELINE": [
        "tools/patch_openko_browser.py",
        "tools/patch_openko_browser_gateway.py",
        "tools/fix_browser_server_ini_case.py",
        "tools/patch_openko_browser_serverlist_probe.py",
        "tools/patch_openko_browser_auth_probe.py",
    ],
    "WS01": ["openko-web/index.html", "tools/ws01_runtime"],
    "WS38": ["content-pipeline", "tools/ws38_content", "tests/content-pipeline"],
    "WS12": ["play-shell", "tools/ws12_launcher", "tests/ws12-launcher"],
    "WS02": ["services/ko-gateway", "tests/ko-gateway"],
    "WS03": ["services/ko1298-session", "tests/ko1298-session"],
    "WS04": ["tools/ws04_character"],
    "WS14": ["services/ko1298-world", "tests/ko1298-world"],
    "WS05": ["tools/ws05_moradon"],
    "WS10": ["qa", "tests/e2e"],
}


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None,
        capture: bool = False) -> str:
    print("+", " ".join(cmd), flush=True)
    completed = subprocess.run(
        cmd,
        cwd=str(cwd or REPO),
        env=env,
        text=True,
        check=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    return (completed.stdout or "").strip()


def git(*args: str, cwd: Path | None = None, capture: bool = True) -> str:
    return run(["git", *args], cwd=cwd, capture=capture)


def verify_refs() -> None:
    for key, (branch, expected) in FROZEN.items():
        ref = f"refs/remotes/origin/{branch}"
        actual = git("rev-parse", ref)
        if actual != expected:
            raise SystemExit(f"FROZEN_REF_CHANGED {key} {branch} expected={expected} actual={actual}")
        print(f"FROZEN_OK {key} {branch}@{actual}")


def checkout_paths(tree: Path, key: str) -> None:
    sha = FROZEN[key][1]
    for path in PATHS[key]:
        run(["git", "checkout", sha, "--", path], cwd=tree)


def write_refs(out: Path) -> None:
    lines = [f"{key} {branch} {sha}" for key, (branch, sha) in FROZEN.items()]
    lines += [f"{key} {value}" for key, value in EXTERNAL.items()]
    (out / "frozen-refs.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def static_and_unit_checks(tree: Path, out: Path) -> None:
    git("diff", "--cached", "--check", cwd=tree, capture=False)

    for json_file in [
        tree / "play-shell/config.json",
        tree / "content-pipeline/manifest.schema.json",
        tree / "content-pipeline/oldko1298.profile.json",
        tree / "services/ko-gateway/package.json",
        tree / "services/ko1298-session/package.json",
        tree / "services/ko1298-world/package.json",
        tree / "qa/package.json",
    ]:
        json.loads(json_file.read_text(encoding="utf-8"))

    run(["node", "tools/ws12_launcher/check-config.cjs"], cwd=tree)
    run(["node", "--test", "tests/ws12-launcher/launcher-core.test.cjs"], cwd=tree)
    run(["node", "--test", "tests/ko-gateway/gateway.test.js"], cwd=tree)
    run(["node", "--test", "tests/ko1298-session/session.test.js"], cwd=tree)
    run(["node", "--test", "tests/ko1298-world/protocol-boundary.test.js", "tests/ko1298-world/world-session.test.js"], cwd=tree)
    run([sys.executable, "-m", "unittest", "discover", "-s", "tests/content-pipeline", "-p", "test_*.py", "-v"], cwd=tree)
    run([sys.executable, "tools/ws05_moradon/test_moradon_gate.py"], cwd=tree)
    run(["node", "--check", "qa/moradon/integration-server.cjs"], cwd=tree)
    run(["node", "--check", "qa/moradon/browser-e2e.cjs"], cwd=tree)

    server_js = (tree / "services/ko1298-session/server.js").read_text(encoding="utf-8")
    if "require('../ko1298-world')" not in server_js:
        raise SystemExit("WS03_WS14_LOAD_PATH_MISSING")

    probe = r"""
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve('services/ko1298-session/server.js'));
const world = req('../ko1298-world');
if (typeof world.WorldSessionService !== 'function') throw new Error('WorldSessionService export missing');
console.log('WS03_WS14_RUNTIME_LOAD_OK');
"""
    run(["node", "-e", probe], cwd=tree)

    tree_sha = git("write-tree", cwd=tree)
    (out / "candidate-tree-sha.txt").write_text(tree_sha + "\n", encoding="utf-8")


def container_checks(tree: Path, out: Path) -> None:
    run(["docker", "build", "-t", "ws50-gateway:rehearsal", "services/ko-gateway"], cwd=tree)

    dockerfile = out / "Dockerfile.session-world"
    dockerfile.write_text(
        "FROM node:22-alpine\n"
        "WORKDIR /app\n"
        "COPY services/ko1298-session /app/services/ko1298-session\n"
        "COPY services/ko1298-world /app/services/ko1298-world\n"
        "CMD [\"node\",\"services/ko1298-session/server.js\"]\n",
        encoding="utf-8",
    )
    run(["docker", "build", "-f", str(dockerfile), "-t", "ws50-session-world:rehearsal", "."], cwd=tree)

    name = "ws50-session-world-rehearsal"
    subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        run(["docker", "run", "-d", "--name", name, "-p", "16100:15100", "-p", "16001:15001", "ws50-session-world:rehearsal"], cwd=tree)
        probe = r"""
const net=require('node:net');
const ports=[16100,16001];
Promise.all(ports.map(port=>new Promise((resolve,reject)=>{
  const s=net.connect({host:'127.0.0.1',port},()=>{s.destroy(); resolve();});
  s.setTimeout(5000,()=>{s.destroy(); reject(new Error('timeout '+port));});
  s.on('error',reject);
}))).then(()=>console.log('SESSION_WORLD_TCP_PORTS_OK')).catch(e=>{console.error(e);process.exit(1)});
"""
        run(["node", "-e", probe], cwd=tree)
        logs = run(["docker", "logs", name], cwd=tree, capture=True)
        (out / "session-world-container.log").write_text(logs + "\n", encoding="utf-8")
        if "auth listening on 15100" not in logs or "game listening on 15001" not in logs:
            raise SystemExit("SESSION_WORLD_CONTAINER_LISTEN_EVIDENCE_MISSING")
    finally:
        subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    compose = out / "docker-compose.ws09-staging.yml"
    compose.write_text(git("show", f"{FROZEN['WS09'][1]}:docker-compose.ws09-staging.yml") + "\n", encoding="utf-8")
    env = os.environ.copy()
    env.update({
        "GATEWAY_IMAGE": "ws50-gateway:rehearsal",
        "KO_SESSION_WORLD_IMAGE": "ws50-session-world:rehearsal",
    })
    rendered = run(["docker", "compose", "-f", str(compose), "config"], cwd=tree, env=env, capture=True)
    (out / "ws09-compose-rendered.yml").write_text(rendered + "\n", encoding="utf-8")


def staging_contract_check(tree: Path, out: Path) -> None:
    gateway_patch = (tree / "tools/patch_openko_browser_gateway.py").read_text(encoding="utf-8")
    ws09_nginx = git("show", f"{FROZEN['WS09'][1]}:infra/nginx/templates/staging.conf.template")

    hardcoded_plain = 'const std::string url = "ws://" + szIP + ":" + std::to_string(dwPort);' in gateway_patch
    supports_wss = '"wss://"' in gateway_patch or "location.protocol" in gateway_patch
    supports_paths = "/auth" in gateway_patch or "/game" in gateway_patch
    ws09_requires_paths = "ws(s)://<staging-host>/auth" in ws09_nginx and "ws(s)://<staging-host>/game" in ws09_nginx

    result = {
        "browser_transport_hardcoded_plain_ws_host_port": hardcoded_plain,
        "browser_transport_explicit_wss_support": supports_wss,
        "browser_transport_auth_game_path_support": supports_paths,
        "ws09_staging_requires_auth_game_paths": ws09_requires_paths,
        "blocker_owner": "WS01" if hardcoded_plain and not supports_wss and not supports_paths and ws09_requires_paths else None,
    }
    (out / "staging-contract.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print("STAGING_CONTRACT", json.dumps(result, sort_keys=True))


def main() -> int:
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="ws50-staging-output-"))
    out.mkdir(parents=True, exist_ok=True)

    verify_refs()
    write_refs(out)

    root = Path(tempfile.mkdtemp(prefix="ws50-staging-tree-"))
    tree = root / "candidate"
    try:
        run(["git", "worktree", "add", "--detach", str(tree), FROZEN["MAIN"][1]], cwd=REPO)
        for key in ["BROWSER_BASELINE", "WS01", "WS38", "WS12", "WS02", "WS03", "WS04", "WS14", "WS05", "WS10"]:
            checkout_paths(tree, key)

        static_and_unit_checks(tree, out)
        container_checks(tree, out)
        staging_contract_check(tree, out)

        latest_ws05 = git("rev-parse", "refs/remotes/origin/ws05-moradon-world")
        if latest_ws05 != FROZEN["WS05"][1]:
            raise SystemExit(f"WS05_CHANGED_DURING_REHEARSAL expected={FROZEN['WS05'][1]} actual={latest_ws05}")

        (out / "result.txt").write_text(
            "DISPOSABLE_TREE_STATIC_TESTS=PASS\n"
            "WS03_WS14_RUNTIME_LOAD=PASS\n"
            "WS02_DOCKER_BUILD=PASS\n"
            "WS03_WS14_CONTAINER_BUILD_AND_BOOT=PASS\n"
            "WS09_COMPOSE_CONFIG=PASS\n"
            "PUBLIC_STAGING_TRANSPORT_COMPATIBILITY=BLOCKED\n"
            "BLOCKER_OWNER=WS01\n",
            encoding="utf-8",
        )
        print(f"WS50_STAGING_REHEARSAL_OK output={out}")
        return 0
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
