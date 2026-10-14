# OldKOWeb DNS cutover plan — PLAN ONLY

Domain ownership is confirmed for `oldkoweb.com`.

**DNS CHANGES PERFORMED: NO**

No registrar, DNS, Cloudflare zone, nameserver, record, proxy-mode, or certificate-setting change was made by WS09. The persistent host has not been selected yet, so the address target is intentionally not invented.

## Exact initial record plan

The recommended production host shape is a vendor-neutral Linux VM/VPS with one stable public IPv4 address. With that topology the cutover records are:

| Type | Host / name | Target | Proxy mode | TTL | Purpose |
|---|---|---|---|---:|---|
| `A` | `@` | **WAITING FOR HOST TARGET** | DNS-only for first cutover | 300 | `oldkoweb.com` official site and canonical edge IP |
| `CNAME` | `play` | `oldkoweb.com` | DNS-only for first cutover | 300 | launcher, immutable WASM/data and same-origin `wss://play.oldkoweb.com/auth` + `/game` |
| `CNAME` | `admin` | `oldkoweb.com` | DNS-only for first cutover | 300 | admin frontend + same-origin `/api/admin/` |
| `CNAME` | `staging` | `oldkoweb.com` | DNS-only while validating | 300 | permanent pre-production launcher/WSS host; optional until staging is commissioned |

`AAAA` is **not** to be added unless the selected host has a stable, routed IPv6 address and IPv6 has passed HTTPS/WSS smoke. `www`, `api`, and `gateway` records are not required by the production topology. Do not create them unless a later product requirement explicitly needs them.

If the selected host does not provide a stable IPv4 address and instead provides a hostname/load-balancer target, stop before cutover and revise the apex row to the registrar-supported `ALIAS`/`ANAME`/flattened-CNAME equivalent. Do not improvise an address.

## Proxy-mode policy

Start DNS-only so origin TLS, Host validation, byte ranges and WebSocket behavior are validated directly. A CDN/proxy may be enabled later after the direct-origin smoke passes; it must preserve:

- WebSocket Upgrade on `/auth` and `/game`;
- byte-range `206` responses for the large `.data` file;
- exact WASM/JS/DATA MIME;
- `latest.json` no-store semantics;
- immutable caching for `/client-content/v1/<version>/...`.

Cloudflare Quick Tunnel remains test/dev fallback only and is not a production DNS target.

## TTL

Keep `300` seconds through first cutover and rollback verification. Raise to `3600` or the normal operations policy only after production and certificate renewal are stable.

## Certificate names

Initial production SAN certificate:

- `oldkoweb.com`
- `play.oldkoweb.com`
- `admin.oldkoweb.com`

Use a separate staging certificate if `staging.oldkoweb.com` is enabled. Do not include unused `api`/`gateway` names.
