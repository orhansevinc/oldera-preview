# WS12 Integration Notes

WS12 does not require changes outside its allowed directories.

## Integration contract

- Serve `play-shell/` and the real client package from the same origin when runtime telemetry is desired.
- `play-shell/config.json` is the only place that points at the client entry, build metadata, required package files and optional WebSocket gateway.
- Keep `gateway.url` empty while a gateway endpoint is not deployed. Set `gateway.required=true` only when launcher start must be blocked on gateway reachability.
- Bump `cacheVersion` whenever the published client package changes. The launcher adds this version to package/client URLs and detects version changes via local storage.
- Current real client wrapper exposes runtime status in `#status`; WS12 reads `runtime.readySelector`, `runtime.readyText` and `runtime.errorText` from config rather than changing the WASM client.

No patch to client/WASM, admin, official website, gateway, server or database is requested by WS12.
