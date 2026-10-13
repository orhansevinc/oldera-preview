# Static deployment artifacts

The reverse proxy serves three read-only directories:

- `deploy/artifacts/site/` -> `oldkoweb.com`
- `deploy/artifacts/play/` -> `play.oldkoweb.com`
- `deploy/artifacts/admin/` -> `admin.oldkoweb.com`

CI/release automation should stage the finished outputs here (or equivalent mounted directories) rather than serving the repository root. This prevents source files, tests and internal metadata from becoming public accidentally.

For the browser client, prefer release-addressed paths such as `play/releases/<git-sha>/client.wasm` and `.data`. Nginx gives those immutable one-year caching; non-versioned `.wasm`/`.data` get a conservative seven-day revalidation policy.
