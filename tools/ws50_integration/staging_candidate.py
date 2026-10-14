#!/usr/bin/env python3
"""WS50 OldKOWeb public-test staging candidate rehearsal.

Builds a disposable source composition from exact provider SHAs using only the
provider-owned surfaces needed by the final test-link track. It never updates
main or provider refs and never full-merges divergent browser branches.
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

# These values are documentation/defaults only for direct invocation. The
# staging_candidate_current.py entry point snapshots every remote ref once at
# run start, then consumes only those exact SHAs.
FROZEN = {
    "MAIN": ("main", "5715c55abd9ecb36bb32a259d045ba9ad1dc9551"),
    "BROWSER_BASELINE": ("openko-browser-port", "18282d0e70de7ccb30244a9f09e2b3bff3040155"),
    "WS01": ("ws01-runtime-build", "25c2fcd9c59e8f7a704f7d2ac0d5c331d0042ff9"),
    "WS02": ("ws02-websocket-gateway", "1738f60945b24e00bdd2266e6600b5c0cf3c64cf"),
    "WS03": ("ws03-ko1298-session", "d634870bbcd2c541695516643d34e0ac119354d7"),
    "WS04": ("ws04-character-client", "32616b1b7ccbdc3de41c0949f182a65e03450d18"),
    "WS05": ("ws05-moradon-world", "0537c481383a69c534799b43810f35e7279c5578"),
    "WS09": ("ws09-production-infra", "bac4f9d1338e385c8aff3989becaa8ed74037b38"),
    "WS10": ("ws10-qa-integration", "b11929915d881e046ff50aa34695c9da70a5480a"),
    "WS11": ("ws11-protocol-lab", "05562662d9d3f13a4b0500d0478e065fd802cfd0"),
    "WS12": ("ws12-browser-launcher", "77f55b2949844e0fdd279526dab0fba4e8ab4f94"),
    "WS14": ("ws14-world-session", "82cdcef40bed265ff4c4ce0fb7c8f6ad8cf2f52b"),
    "WS38": ("ws38-client-content-pipeline", "5f323f3cf055ba7f96d928605a2f2faf84e609cb"),
    "WS45": ("ws45-session-ownership", "4a66338743553c2781c68ca84b866ff4e999c14e"),
}

EXTERNAL = {
    "OPENKO": "97eb0ea20207afc0c360bfed6915113572711be3",
    "KO_ASSETS": "2055ee6ed77f1b5cfef23832dd5bc31909e14a66",
    "EMSCRIPTEN": "6.0.12",
}

# Narrow-copy surfaces only. The order in main() is the authoritative source
# composition order for this sprint. WS10 contributes QA/harness only.
PATHS = {
    "BROWSER_BASELINE": [
        "tools/patch_openko_browser.py",
        "tools/patch_openko_browser_gateway.py",
        "tools/fix_browser_server_ini_case.py",
        "tools/patch_openko_browser_serverlist_probe.py",
        "tools/patch_openko_browser_auth_probe.py",
    ],
    "WS01": ["openko-web/index.html", "tools/ws01_runtime"],
    "WS12": ["play-shell", "tools/ws12_launcher", "tests/ws12-launcher"],
    "WS38": ["content-pipeline", "tools/ws38_content", "tests/content-pipeline"],
    "WS02": ["services/ko-gateway", "tests/ko-gateway"],
    "WS03": ["services/ko1298-session", "tests/ko1298-session"],
    "WS14": ["services/ko1298-world", "tests/ko1298-world"],
    "WS45": ["services/session-ownership", "tests/session-ownership"],
    "WS04": ["tools/ws04_character"],
    "WS05": ["tools/ws05_moradon"],
    "WS11": ["tools/ws11_protocol", "protocol-lab", "tests/protocol-lab"],
    "WS09": ["infra", "deploy", "docker-compose.ws09.yml", "docker-compose.ws09-staging.yml"],
    "WS10": ["qa", "tests/e2e"],
}

APPLY_ORDER = [
    "BROWSER_BASELINE",  # required source-generation baseline before WS01/04/05 patches
    "WS01",
    "WS12",
    "WS38",
    "WS02",
    "WS03",
    "WS14",
    "WS45",
    "WS04",
    "WS05",
    "WS11",
    "WS09",
    "WS10",  # QA/harness only; no production implementation surface
]


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


def node_test_glob(tree: Path, pattern: str) -> None:
    files = sorted(str(path.relative_to(tree)) for path in tree.glob(pattern))
    if not files:
        raise SystemExit(f"TEST_GLOB_EMPTY {pattern}")
    run(["node", "--test", *files], cwd=tree)


def static_and_unit_checks(tree: Path, out: Path) -> None:
    git("diff", "--cached", "--check", cwd=tree, capture=False)

    for json_file in [
        tree / "play-shell/config.json",
        tree / "play-shell/config.staging.example.json",
        tree / "content-pipeline/manifest.schema.json",
        tree / "content-pipeline/oldko1298.profile.json",
        tree / "services/ko-gateway/package.json",
        tree / "services/ko1298-session/package.json",
        tree / "services/ko1298-world/package.json",
        tree / "services/session-ownership/package.json",
        tree / "qa/package.json",
    ]:
        json.loads(json_file.read_text(encoding="utf-8"))

    run(["node", "--test", "tools/ws01_runtime/transport_config.test.cjs"], cwd=tree)
    run(["node", "tools/ws12_launcher/check-config.cjs"], cwd=tree)
    node_test_glob(tree, "tests/ws12-launcher/*.test.cjs")
    node_test_glob(tree, "tests/ko-gateway/*.test.js")
    node_test_glob(tree, "tests/ko1298-session/*.test.js")
    node_test_glob(tree, "tests/ko1298-world/*.test.js")
    node_test_glob(tree, "tests/session-ownership/*.test.js")
    run([sys.executable, "-m", "unittest", "discover", "-s", "tests/content-pipeline", "-p", "test_*.py", "-v"], cwd=tree)
    run([sys.executable, "-m", "unittest", "discover", "-s", "tests/protocol-lab", "-p", "test_*.py", "-v"], cwd=tree)
    run([sys.executable, "tools/ws05_moradon/test_moradon_gate.py"], cwd=tree)
    run(["node", "--check", "qa/moradon/integration-server.cjs"], cwd=tree)
    run(["node", "--check", "qa/moradon/browser-e2e.cjs"], cwd=tree)
    run(["sh", "deploy/verify-config.sh"], cwd=tree)

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
    run(["docker", "build", "-f", "services/ko-gateway/Dockerfile", "-t", "ws50-gateway:rehearsal", "."], cwd=tree)

    dockerfile = out / "Dockerfile.session-world"
    dockerfile.write_text(
        "FROM node:22-alpine\n"
        "WORKDIR /app\n"
        "COPY services/ko1298-session /app/services/ko1298-session\n"
        "COPY services/ko1298-world /app/services/ko1298-world\n"
        "COPY services/session-ownership /app/services/session-ownership\n"
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
    shutil.copyfile(tree / "docker-compose.ws09-staging.yml", compose)
    env = os.environ.copy()
    env.update({
        "GATEWAY_IMAGE": "ws50-gateway:rehearsal",
        "KO_SESSION_WORLD_IMAGE": "ws50-session-world:rehearsal",
    })
    rendered = run(["docker", "compose", "-f", str(compose), "config"], cwd=tree, env=env, capture=True)
    (out / "ws09-compose-rendered.yml").write_text(rendered + "\n", encoding="utf-8")


def staging_contract_check(tree: Path, out: Path) -> None:
    pre_js = (tree / "tools/ws01_runtime/browser_transport_pre.js").read_text(encoding="utf-8")
    prepare = (tree / "tools/ws01_runtime/prepare_browser_source.py").read_text(encoding="utf-8")
    browser_index = (tree / "openko-web/index.html").read_text(encoding="utf-8")
    launcher_config = json.loads((tree / "play-shell/config.staging.example.json").read_text(encoding="utf-8"))
    ws09_nginx = (tree / "infra/nginx/templates/staging.conf.template").read_text(encoding="utf-8")
    mime_types = (tree / "infra/nginx/mime.types").read_text(encoding="utf-8")

    endpoint_pairs = {(entry["name"], entry["url"]) for entry in launcher_config["gateway"]["endpoints"]}
    result = {
        "ws01_config_driven_resolver": "OldKOWebResolveWebSocketUrl" in prepare and "oldkoResolveTransportUrl" in pre_js,
        "ws01_https_to_wss": "endpointUrl.protocol === 'https:'" in pre_js and "endpointUrl.protocol = 'wss:'" in pre_js,
        "ws01_rejects_https_plain_ws": "HTTPS pages may not use an insecure ws:// endpoint" in pre_js,
        "ws01_default_auth_game_routes": all(token in browser_index for token in ("15100", "15001", "'/auth'", "'/game'")),
        "ws12_auth_game_readiness": {("auth", "/auth"), ("game", "/game")}.issubset(endpoint_pairs),
        "ws12_strict_publication": bool(launcher_config["publication"].get("requirePublicationMarker") and launcher_config["publication"].get("verifyRequiredFiles") and launcher_config["publication"].get("strictContentType")),
        "ws09_auth_game_edge": "location /auth" in ws09_nginx and "location /game" in ws09_nginx,
        "ws09_js_mime": "text/javascript" in mime_types and "js mjs" in mime_types,
        "ws09_wasm_mime": "application/wasm" in mime_types and "wasm" in mime_types,
        "ws09_data_mime": "application/octet-stream" in mime_types and "data" in mime_types,
    }
    result["all_required_contracts"] = all(result.values())
    result["blocker_owner"] = None if result["all_required_contracts"] else "WS50_COMPOSITION_CONTRACT"
    (out / "staging-contract.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("STAGING_CONTRACT", json.dumps(result, sort_keys=True))
    if not result["all_required_contracts"]:
        raise SystemExit("STAGING_CONTRACT_MISMATCH")


def main() -> int:
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="ws50-staging-output-"))
    out.mkdir(parents=True, exist_ok=True)

    verify_refs()
    write_refs(out)

    root = Path(tempfile.mkdtemp(prefix="ws50-staging-tree-"))
    tree = root / "candidate"
    try:
        run(["git", "worktree", "add", "--detach", str(tree), FROZEN["MAIN"][1]], cwd=REPO)
        for key in APPLY_ORDER:
            checkout_paths(tree, key)

        static_and_unit_checks(tree, out)
        container_checks(tree, out)
        staging_contract_check(tree, out)

        (out / "result.txt").write_text(
            "DISPOSABLE_TREE_STATIC_TESTS=PASS\n"
            "WS01_WSS_TRANSPORT_CONTRACT=PASS\n"
            "WS12_WS38_PUBLICATION_CONTRACT=PASS\n"
            "WS03_WS14_RUNTIME_LOAD=PASS\n"
            "WS45_SESSION_OWNERSHIP_TESTS=PASS\n"
            "WS11_PROTOCOL_LAB_TESTS=PASS\n"
            "WS02_DOCKER_BUILD=PASS\n"
            "WS03_WS14_WS45_CONTAINER_BUILD_AND_BOOT=PASS\n"
            "WS09_COMPOSE_CONFIG_AND_MIME=PASS\n"
            "SOURCE_STAGING_COMPOSITION=PASS\n"
            "PUBLICATION_GATE=EXACT_WS10_PASS_ARTIFACT_REQUIRED\n",
            encoding="utf-8",
        )
        print(f"WS50_STAGING_REHEARSAL_OK output={out}")
        return 0
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
