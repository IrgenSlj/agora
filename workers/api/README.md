# Agora API Worker

Cloudflare Worker scaffold for the S2 catalog surface.

## Routes

- `GET /v1/health` returns a small liveness payload.
- `GET /v1/catalog?cursor=<purl>&limit=<n>` reads normalized artifacts from D1, ordered by purl, and
  includes source references from `artifact_sources`.

## Local Setup

```bash
wrangler d1 create agora-catalog
wrangler d1 execute agora-catalog --local --file workers/api/schema.sql
wrangler dev --config workers/api/wrangler.toml
```

Replace `database_id` in `wrangler.toml` after creating the real D1 database. Do not commit secrets
or account tokens.
