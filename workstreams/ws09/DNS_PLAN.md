# OldKOWeb DNS plan

**Current assumption:** the domain may not yet be purchased. This is a plan only; no DNS change has been made.

| Name | Type | Target after hosting exists | Required | Purpose |
|---|---|---|---|---|
| `oldkoweb.com` | A/AAAA or ALIAS | Public reverse-proxy/LB address | Yes | Official site |
| `www.oldkoweb.com` | CNAME | `oldkoweb.com` | Optional | Convenience redirect/alias |
| `play.oldkoweb.com` | A/AAAA or CNAME | Same proxy/LB | Yes | Browser WASM client + preferred `/ws` |
| `admin.oldkoweb.com` | A/AAAA or CNAME | Same proxy/LB | Yes | Admin UI + same-origin API |
| `api.oldkoweb.com` | A/AAAA or CNAME | Same proxy/LB | Optional | Direct Admin API host |
| `gateway.oldkoweb.com` | A/AAAA or CNAME | Same proxy/LB | Optional | Dedicated WSS host |

## TTL

Use 300 seconds during first cutover. After the topology is stable, increase to 3600 seconds or the operator's normal policy.

## Certificate SANs

If one certificate is used, include only hostnames that are actually enabled. Minimum expected set: `oldkoweb.com`, `play.oldkoweb.com`, `admin.oldkoweb.com`. Add `www`, `api` and `gateway` only if their DNS records are created.

## Important

Do not create records before the production host has a stable public target. Do not enable the production Nginx template before the corresponding certificate files exist.
