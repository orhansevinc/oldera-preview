# WS09 staging play artifacts

This directory is the deployment input for `docker-compose.ws09-staging.yml`.
It intentionally contains no generated client binaries in git.

Before a staging bring-up, materialize the approved provider outputs here:

```text
deploy/artifacts/staging-play/
  play-shell/
    index.html
    app.js
    launcher-core.js
    launcher.css
    config.json
  real1298/
    index.html
    BUILD.txt
    KnightOnLine.js
    KnightOnLine.wasm
    KnightOnLine.data
```

Optional WS38 publication artifacts may also be staged under:

```text
client-content/v1/<contentVersion>/...
latest.json
rollback.json
```

For WS38 versioned content, upload/copy the immutable files first, then the manifest,
verify them, publish `_complete.json` last, and only then update `latest.json`.

`play-shell/config.json` is a deployment artifact. For a public test, keep the client
package on the same origin and set the launcher gateway probe to the public staging
endpoint (normally `wss://<host>/auth`) without editing the WS12 provider branch.
The real KO client transport itself must be the integrated client build already proven
by WS10; this launcher probe does not replace the client's auth/game transport wiring.
