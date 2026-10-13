# OldKOWeb Ranking API (WS37)

Public, read-only ranking backend for the OldKOWeb website.

## Endpoints

- `GET /healthz`
- `GET /openapi.json`
- `GET /v1/rankings/characters?metric=level|national_points`
- `GET /v1/rankings/levels`
- `GET /v1/rankings/national-points`
- `GET /v1/rankings/clans`

Ranking endpoints support `nation`, `q`, `page`, and `pageSize`. Character endpoints also support `class`.

## Security / privacy

The service is deliberately read-only. Non-GET methods are rejected with `405`. Public DTOs are built from explicit whitelists, so repository rows may contain internal columns without leaking account usernames, email addresses, IP addresses, ban reasons, or admin-only data.

## Run

```bash
cd services/ranking-api
npm test
npm start
```

The standalone server uses an empty in-memory repository. Production must inject a read-only adapter implementing `RankingRepository`; see `workstreams/ws37/INTEGRATION_PATCH.md`.
