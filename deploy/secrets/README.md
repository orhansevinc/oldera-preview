# Runtime secrets

This directory intentionally contains no secret values.

Before starting the real stack, create `deploy/secrets/postgres_password.txt` on the deployment host with mode `0600` and a randomly generated password. Never commit that file.

Example on Linux:

```sh
umask 077
openssl rand -base64 36 > deploy/secrets/postgres_password.txt
```

TLS private keys also stay outside git under `deploy/tls/` (or another host path selected with `TLS_CERT_DIR`).
