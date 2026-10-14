# WS50 — STAGING LINK HANDOFF

## Release decision

**STAGING LINK CANDIDATE: READY**

This handoff publishes the exact immutable gameplay candidate below without resolving any provider branch again.

```text
FINAL_PROVIDER_SET=WS50-C5@sha256:7ac3b8a4c06b67e52b8d18518ef8c82209a60c6101c33609a4c16e64d84f119e
WS50_MANIFEST_COMMIT=0d5001095fa3b43693b4fa0cda615f84e2cb7df5
```

## Exact real-browser PASS

```text
WS10_PASS_RUN_ID=38604174659
WS10_PASS_HEAD_SHA=163f2ebf81e750bf746fdaa277695329a0682e22
WS10_PASS_ARTIFACT_NAME=ws10-c5-visibility-e2e-4
WS10_CLIENT_ARTIFACT_NAME=ws10-c5-visibility-passing-client-4
WS10_CLIENT_ARTIFACT_ID=11915666463
WS10_CLIENT_ARTIFACT_DIGEST=sha256:f749750fc5bb0249a67b712bd4e1a03847773d8845fd209508b8c95f6c447a83
```

Run 38604174659 completed SUCCESS with the real KO1298 C++/Emscripten/WASM/WebGL2 client and proved login -> character -> Moradon -> terrain/shapes/local player -> unified NPC/mob visibility -> detail parse -> entity creation -> authoritative model -> render -> movement.

## Exact public composition inputs

The production/publication harness is frozen at the WS09 commit below. The gameplay/provider composition remains the immutable WS50-C5 set.

```text
WS09_SHA=68fd2ddaa8e91d5e6e284882906b49dfc2c831e9
WS01_SHA=57d0aa7c6a82810d5f126bda83a368e7eb7801bb
WS02_SHA=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
WS03_SHA=495de481726734d85cc28b3d432835799aff7e48
WS12_SHA=121bb7bdb82c364bf9459111096f5ff007873a61
WS14_SHA=ed5f806ce7505f4dfae406e4164735def63b6c86
WS38_SHA=5f323f3cf055ba7f96d928605a2f2faf84e609cb
WS11_SHA=944b6ff9b6329af29f1048a74aa6e14fca141639
WS16_SHA=5ed48ff32187000312652838674388df52fc3fb7
WS25_SHA=13c9bafe287b250d56b52f19e97a02e7ef18e6e5
WS31_SHA=546d2ab62cd46a97f3385ebcddbe0c775a02c2eb
OPENKO_SHA=97eb0ea20207afc0c360bfed6915113572711be3
KO_ASSETS_SHA=2055ee6ed77f1b5cfef23832dd5bc31909e14a66
```

## Public test contract

Single user entry:

```text
https://<temporary-host>/play-shell/
```

Same-origin browser transport:

```text
wss://<temporary-host>/auth
wss://<temporary-host>/game
```

WS09 must reuse the exact passing WS10 client artifact and the exact integrated WS02 + WS03 + WS14 backend above. Required public gates are HTTPS, launcher, manifest, `_complete`, exact JS/WASM/DATA MIME, DATA range, `/auth` WSS 101, `/game` WSS 101, credential-free KO auth smoke, and WS12 publication preflight.

## WS09 branch-native request values

```text
ws10_run_id=38604174659
ws10_head_sha=163f2ebf81e750bf746fdaa277695329a0682e22
ws10_pass_artifact_name=ws10-c5-visibility-e2e-4
ws10_client_artifact_name=ws10-c5-visibility-passing-client-4
ws01_sha=57d0aa7c6a82810d5f126bda83a368e7eb7801bb
ws02_sha=1738f60945b24e00bdd2266e6600b5c0cf3c64cf
ws03_sha=495de481726734d85cc28b3d432835799aff7e48
ws12_sha=121bb7bdb82c364bf9459111096f5ff007873a61
ws14_sha=ed5f806ce7505f4dfae406e4164735def63b6c86
ws38_sha=5f323f3cf055ba7f96d928605a2f2faf84e609cb
keepalive_minutes=90
```

`ws50_handoff_ref` is the exact commit containing this file.

```text
DECISION=READY
BLOCKER_OWNER=NONE
PUBLIC_TEST_LINK=READY_FOR_WS09_EPHEMERAL_PUBLISHER
```
