# WS09 STATUS

## State

**Infrastructure scaffold complete; production cutover intentionally not performed.**

Branch target: `ws09-production-infra` from `main`.

Delivered:

- Docker Compose topology for reverse proxy, Admin API, KO session, WebSocket gateway and PostgreSQL.
- Separate local HTTP and production HTTPS Nginx templates.
- Explicit WebSocket upgrade headers and long-lived socket timeouts.
- Correct `.wasm` MIME type and `.data` binary handling.
- Conservative cache policy for mutable WASM/data plus one-year immutable caching under release-addressed paths.
- Read-only static roots for official site, browser client and admin UI.
- PostgreSQL named volume, health check, restart policy and rotating container logs.
- Runtime secret file pattern with no committed passwords.
- Backup/restore scripts and operational runbook.
- DNS plan for root, `play`, `admin`, optional `api` and optional `gateway`.
- GitHub Actions configuration/static validation workflow.

## Validation

`sh deploy/verify-config.sh` validates the compose YAML structure, shell syntax and required Nginx directives without requiring Docker.

A full end-to-end stack cannot honestly be marked PASS until WS03/WS07/WS08 publish their runtime images and WS02 publishes a complete gateway image. At WS09 creation time WS03/WS07/WS08 branches were still at the shared `main` base; WS02 had only begun its gateway scaffold.

## Production readiness gate

Do not switch to `production.conf.template` until all of the following are true:

1. `oldkoweb.com` is actually purchased and under the operator's control.
2. DNS records resolve to the selected host/load balancer.
3. Valid certificates exist for every enabled hostname.
4. Backend image tags are immutable release tags/digests and their health contracts match this compose file.
5. Database migrations and a tested backup/restore cycle have completed.
