# Service environment contract

WS09 only defines infrastructure-facing defaults. WS02/WS03/WS08 remain owners of their application configuration.

Expected container interfaces:

- Admin API: HTTP on `0.0.0.0:8080`, health at `/health`.
- KO session: TCP on `0.0.0.0:15001`.
- Gateway: HTTP/WebSocket on `0.0.0.0:8080`, health at `/health`, upstream `ko-session:15001`.
- Database: PostgreSQL 17-compatible endpoint `db:5432`.

Database consumers receive `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` and `DATABASE_PASSWORD_FILE`. If a service chooses another variable contract, adapt the compose environment at integration time; do not put plaintext passwords in git.
