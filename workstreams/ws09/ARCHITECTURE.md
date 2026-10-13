# OldKOWeb production architecture

## Topology

```text
Internet
   |
   | 80/443
   v
TLS reverse proxy (Nginx)
   |-- oldkoweb.com ----------> static official site
   |-- play.oldkoweb.com -----> static WASM/.data client
   |          `-- /ws --------> WebSocket gateway ----TCP----> KO 1298 session
   |-- admin.oldkoweb.com ----> static admin UI
   |          `-- /api/admin -> Admin API -------------------> PostgreSQL
   |-- api.oldkoweb.com ------> Admin API (optional)
   `-- gateway.oldkoweb.com --> WebSocket gateway (optional)
                                      |
KO session --------------------------> PostgreSQL
```

Only the reverse proxy publishes host ports. Backend services and PostgreSQL live on an internal Docker network. PostgreSQL data is persisted in the named `oldkoweb_postgres_data` volume.

## Why not GitHub Pages

GitHub Pages is appropriate only for static files. It cannot host the persistent Node/TCP services required by the KO session server, WebSocket-to-TCP gateway, Admin API or database. The production topology therefore assumes a generic Linux container host (or equivalent managed container platform) with persistent storage.

## Static artifact boundaries

The repository root is never served directly. Release automation stages three explicit trees under `deploy/artifacts/`: official site, play client and admin UI. This minimizes accidental source disclosure and lets each surface use independent cache/security policy.

For Emscripten artifacts:

- `.wasm` => `application/wasm`.
- `.data` => `application/octet-stream`.
- `index.html` => no-store/no-cache to pick up new releases quickly.
- mutable `.wasm`/`.data` => seven-day cache with revalidation.
- `/releases/<git-sha>/...` assets => one-year `immutable` cache.

## WebSocket path

Preferred browser endpoint: `wss://play.oldkoweb.com/ws`. Keeping the socket on the same origin as the client reduces CORS/origin complexity. `wss://gateway.oldkoweb.com/` remains available as an optional dedicated endpoint.

Nginx explicitly forwards `Upgrade` and `Connection` headers, disables proxy buffering and extends read/send timeouts for game sessions.

## HTTPS/TLS

Production Nginx expects `fullchain.pem` and `privkey.pem` under the host path selected by `TLS_CERT_DIR`. Certificates may come from Let's Encrypt/ACME, a cloud load balancer or another CA. WS09 does not assume any DNS registrar, hosting vendor or certificate vendor.

Port 80 remains available for ACME challenge/redirect. HSTS is only in the production template and should be enabled after HTTPS is confirmed on every intended subdomain.

## CSP and CORS

CSP ships as **Report-Only** initially because the current static applications may still contain inline code/assets. After collecting violations, move to an enforced policy with hashes/nonces and no unsafe fallbacks.

Admin API is preferably consumed same-origin through `admin.oldkoweb.com/api/admin`, matching the existing frontend default. If `api.oldkoweb.com` is used directly, the API should allow only explicit OldKOWeb origins, send `Vary: Origin`, and never use `Access-Control-Allow-Origin: *` with credentials.

## Health, restart and logs

- PostgreSQL: `pg_isready`.
- Admin API: HTTP `/health`.
- Gateway: HTTP `/health`.
- KO session: local TCP accept check.
- Reverse proxy: `/healthz`.
- Containers: `restart: unless-stopped`.
- Docker JSON logs rotate at 20 MB x 5 files per container.

Production monitoring should scrape health/metrics externally and ship logs off-host; Docker rotation is only the local safety net.

## Browser isolation note

If the final Emscripten build enables pthreads/`SharedArrayBuffer`, `play.oldkoweb.com` will also need compatible `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers, and every cross-origin asset must opt into CORP/CORS. Do not enable these blindly before WS01 confirms the runtime requirement because they can block third-party resources.

## Hosting choices

The files are vendor-independent:

| Option | Fit | Tradeoff |
|---|---|---|
| Single maintained Linux VM | Best first production target | Lowest complexity; operator owns patching/backups |
| Managed containers + managed PostgreSQL | Good growth path | Higher cost; verify long-lived WebSocket/TCP limits and private networking |
| Hybrid static CDN + container backend | Good after launch | Fast static delivery; introduces another cache/deploy layer |

The generic Compose/Nginx files assume the first option but keep the service boundaries portable. Static surfaces can later move to object storage/CDN without changing the game/session/database topology.
