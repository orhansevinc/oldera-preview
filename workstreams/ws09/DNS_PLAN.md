# OldKOWeb DNS/TLS cutover plan — permanent-domain task

Domain ownership is confirmed for `oldkoweb.com`. The earlier “do not touch DNS” instruction applied to the ephemeral test phase only. WS09 is now authorized to perform the controlled permanent cutover, but only after an authorized persistent host target exists and the authoritative DNS zone has been inspected.

**CURRENT DNS MUTATION STATE: NOT APPLIED**

Reason: no verified persistent host/IP or connected authoritative DNS provider is available to this WS09 session. Do not invent a target and do not use a temporary tunnel as the permanent target.

## Preservation rule

Before the first mutation, export/snapshot the authoritative zone and record every existing value. Preserve unrelated records, especially MX, TXT/SPF/DKIM/DMARC, CAA, verification records, nameservers and registrar/domain ownership settings. Only the records needed for apex/play/admin may be changed.

## Intended first-cutover records

If the selected host exposes one stable public IPv4:

| Type | Name | Target | Initial mode | TTL | Purpose |
|---|---|---|---|---:|---|
| `A` | `@` | VERIFIED_PERSISTENT_IPV4 | DNS-only/direct origin | 300 | official website + same-origin account API |
| `CNAME` | `play` | `oldkoweb.com` | DNS-only/direct origin | 300 | launcher/client + `/auth` + `/game` WSS |
| `CNAME` | `admin` | `oldkoweb.com` | DNS-only/direct origin | 300 | admin frontend + `/api/admin/` |

Do not add `AAAA` until the host has verified routed IPv6 and IPv6 HTTPS/WSS passes. If the host exposes only a load-balancer hostname, use the DNS provider’s supported apex ALIAS/ANAME/flattening mechanism instead of fabricating an A record.

No public `api.oldkoweb.com` or `gateway.oldkoweb.com` is required by the current topology. The public account API is same-origin under `oldkoweb.com`; its exact route comes from `coordination/handoffs/official-site-release.json` and must not be guessed.

## TLS

Initial certificate SANs:

- `oldkoweb.com`
- `play.oldkoweb.com`
- `admin.oldkoweb.com`

TLS terminates at the WS09 edge. Validate certificate hostname/chain, `/auth` and `/game` WebSocket Upgrade, `.data` range `206`, exact JS/WASM/DATA MIME and real browser gameplay before enabling any CDN proxy. HSTS remains off for initial cutover; enable it only after renewal and rollback are proven.

## Cutover order

1. Provision/authorize persistent host and stable target.
2. Stage exact permanent release bundle and immutable service images.
3. Complete owner-side persistent account/game/admin adapters and promote the resulting WS50 child candidate if runtime composition changed.
4. Consume the official-site handoff and stage its exact site/admin/account artifacts/routes.
5. Bring origin up privately and run Host-header/local smoke.
6. Snapshot authoritative DNS records.
7. Apply only apex/play/admin changes with TTL 300.
8. Issue/activate SAN TLS if ACME requires public DNS, then run real-domain acceptance.
9. Keep TTL 300 until browser E2E, restart persistence and rollback verification all pass.
10. Raise TTL only after stability is proven.

## Rollback

Retain the previous DNS values before mutation. If cutover fails, restore those values while TTL is 300, reactivate previous static/image identities and re-run smoke. Never auto-roll back a database migration; follow WS07/WS30 recovery rules.

Quick Tunnel remains dev/fallback evidence only and is never a permanent DNS target.
