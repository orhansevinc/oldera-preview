# OldKOWeb deployment

This directory contains runtime-only deployment helpers for WS09. It does not deploy or modify DNS by itself.

Start with:

1. Copy `deploy/.env.example` to `.env` on the target host.
2. Create `deploy/secrets/postgres_password.txt` locally; never commit it.
3. Stage release outputs in `deploy/artifacts/site`, `deploy/artifacts/play` and `deploy/artifacts/admin`.
4. Run `./deploy/verify-config.sh` and `docker compose --env-file .env -f docker-compose.ws09.yml config --quiet`.
5. Follow `workstreams/ws09/RUNBOOK.md` for startup, backup, domain cutover and rollback.

The default Nginx template is local HTTP mode. `production.conf.template` must not be enabled until domain ownership, DNS and valid TLS certificates are confirmed.
