# WS50 Conflicts

Actual Git merge conflicts: **0**.

The following records are auto-merge/shared-file ownership overlaps. WS50 did not modify product code to resolve them.

## Shared browser stack file set

`SHARED_BROWSER_STACK_SET` =
`.github/workflows/openko-browser-auth-v2.yml`,
`.github/workflows/openko-browser-auth.yml`,
`.github/workflows/openko-browser-network-v2.yml`,
`.github/workflows/openko-browser-network.yml`,
`.github/workflows/openko-browser-port.yml`,
`.github/workflows/openko-browser-serverlist-roundtrip.yml`,
`BROWSER_PORT_CHECKPOINT.md`,
`gateway/oldera-gateway.mjs`,
`openko-web/KnightOnLine.data`,
`openko-web/KnightOnLine.js`,
`openko-web/KnightOnLine.wasm`,
`openko-web/README.txt`,
`openko-web/index.html`,
`tools/browser_auth_driver.cjs`,
`tools/browser_login_probe_server.py`,
`tools/browser_nation_driver.cjs`,
`tools/enable_openko_browser_network.py`,
`tools/fix_browser_server_ini_case.py`,
`tools/ko_auth_stub.mjs`,
`tools/ko_game_stub.mjs`,
`tools/ko_login_stub.mjs`,
`tools/ko_tcp_probe.mjs`,
`tools/patch_openko_browser.py`,
`tools/patch_openko_browser_auth_probe.py`,
`tools/patch_openko_browser_gateway.py`,
`tools/patch_openko_browser_serverlist_probe.py`.

WS_A: WS01
WS_B: WS04
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS01
RECOMMENDED_ORDER: WS01 before WS04; review shared ownership

WS_A: WS01
WS_B: WS11
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS01
RECOMMENDED_ORDER: WS01 before WS11; review shared ownership

WS_A: WS01
WS_B: WS42
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS01
RECOMMENDED_ORDER: WS01 before WS42; review shared ownership

WS_A: WS01
WS_B: WS43
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS01
RECOMMENDED_ORDER: WS01 before WS43; review shared ownership

WS_A: WS04
WS_B: WS11
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS04
RECOMMENDED_ORDER: WS04 before WS11; review shared ownership

WS_A: WS04
WS_B: WS42
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS04
RECOMMENDED_ORDER: WS04 before WS42; review shared ownership

WS_A: WS04
WS_B: WS43
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS04
RECOMMENDED_ORDER: WS04 before WS43; review shared ownership

WS_A: WS11
WS_B: WS42
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS11
RECOMMENDED_ORDER: WS11 before WS42; review shared ownership

WS_A: WS11
WS_B: WS43
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS11
RECOMMENDED_ORDER: WS11 before WS43; review shared ownership

WS_A: WS42
WS_B: WS43
FILES: SHARED_BROWSER_STACK_SET
CONFLICT_TYPE: workflow path conflict (auto-merge/ownership overlap)
SUGGESTED_OWNER: WS42
RECOMMENDED_ORDER: WS42 before WS43; review shared ownership
