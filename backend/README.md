# `agora` backend

Cloudflare Workers + D1 backend behind the `agora` CLI's live-mode features (community, reviews, profiles, publishing, moderation).

The CLI works **fully offline** by default; this backend is opt-in via `--api`, `AGORA_API_URL`, or `agora auth login`. There is no public hosted instance yet — self-host with the instructions below, or follow [`../ROADMAP.md`](../ROADMAP.md) Phase 2 for the deploy gate.

## Stack

- Runtime: Cloudflare Workers
- Router: [Hono](https://hono.dev)
- DB: Cloudflare D1 (SQLite)
- Auth: OAuth-style JWT pair (1h access + 90d refresh, hashed-`jti` rotation); GitHub used only for identity binding

See [`../SECURITY.md`](../SECURITY.md) for the full authentication model.

## Endpoints

| Group | Endpoint |
|---|---|
| **Health** | `GET /` · `GET /health` |
| **Auth** | `POST /auth/device/code` · `POST /auth/device/token` · `POST /auth/refresh` · `POST /auth/logout` |
| **Marketplace** | `GET /api/packages` · `GET /api/packages/:id` · `POST /api/packages` · `GET /api/workflows` · `GET /api/workflows/:id` · `POST /api/workflows` |
| **Community** | `GET /api/community/boards` · `GET /api/community/threads?board=&sort=top\|new\|active&page=` · `GET /api/community/thread/:id` · `GET /api/community/search?q=&board=&limit=` · `POST /api/community/threads` · `POST /api/community/reply/:parentId` · `POST /api/community/vote/:targetId` · `POST /api/community/flag/:targetId` |
| **Users / reviews** | `GET /api/users/:username` (includes `reputation`) · `GET /api/reviews` · `POST /api/reviews` |
| **Aggregation** | `GET /api/aggregate/packages` · `GET /api/aggregate/mcp/:name` · `GET /api/aggregate/github/:owner/:repo` |
| **Admin** | `POST /api/admin/hide` · `GET /api/admin/log` · `POST /api/admin/reputation/recompute` |

Write endpoints require a bearer access token. Admin endpoints require the caller's user id to appear in the comma-separated `AGORA_ADMIN_USER_IDS` env (no schema flag). Length caps on `POST /api/packages|workflows|discussions`. Sort param on `/api/community/threads` is validated against an explicit allowlist before SQL interpolation.

Community search uses an FTS5 virtual table (`discussions_fts`, `discussion_replies_fts`) with sync triggers — see `schema.sql:231+` and `sanitizeFtsQuery` in `../src/community/search.ts`.

## Local development

```bash
bun install
bun run dev        # wrangler dev with the D1 binding
curl http://localhost:8787/health
```

Backend has its own tsconfig:

```bash
bun run typecheck  # tsc --noEmit
```

## Deploy

```bash
wrangler login
wrangler d1 create agora
wrangler d1 execute agora --file=schema.sql
wrangler secret put AUTH_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
# Comma-separated user ids granted moderator commands:
wrangler secret put AGORA_ADMIN_USER_IDS
wrangler deploy
```

| Variable | Required |
|---|---|
| `AUTH_SECRET` | yes — JWT signing key |
| `GITHUB_CLIENT_ID` | yes |
| `GITHUB_CLIENT_SECRET` | yes |
| `AGORA_ADMIN_USER_IDS` | no — comma-separated user ids for `agora admin *` |
| `AGORA_ENV` | no — `development` or `production`; toggles secure cookie flag |

## Schema

`schema.sql` — `users`, `packages`, `workflows`, `discussions`, `discussion_replies` (with `hidden`, `author_is_llm`, `author_model`), `discussions_fts` + `discussion_replies_fts` (FTS5 with sync triggers), `votes`, `flags`, `kill_switch_log`, `reviews`, `refresh_tokens`, `rate_limits`, `device_codes`.

Manual migrations for live D1 instances are appended at the bottom of the schema file.

## Status

- Code: feature-complete for Phase 1.5 + 1.6
- Rate-limit middleware: wired (`60/min` read, `10/min` write, anonymous half-quota)
- Hosted deploy: ready — see steps above
- Self-hosting: supported with the steps above
