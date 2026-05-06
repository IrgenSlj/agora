# Agora Backend

<p align="center">
  Cloudflare Workers API for the Agora marketplace.
</p>

<p align="center">
  <a href="https://cloudflare.com"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare" alt="Cloudflare"></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/Hono-EE4D3C?logo=hono" alt="Hono"></a>
  <a href="https://developers.cloudflare.com/d1/"><img src="https://img.shields.io/badge/D1-SQLite-3B82F6" alt="D1"></a>
</p>

## Overview

REST API backend built with Hono that provides:
- Package and workflow management
- User authentication (GitHub OAuth)
- Real-time npm/GitHub data aggregation
- Community features (discussions, reviews)

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: GitHub OAuth

## API Endpoints

### Packages
- `GET /api/packages` - List/search packages
- `GET /api/packages/:id` - Get package details
- `POST /api/packages` - Publish or update a package

### Workflows
- `GET /api/workflows` - List/search workflows
- `GET /api/workflows/:id` - Get workflow details
- `POST /api/workflows` - Publish or update a workflow

### Community
- `GET /api/discussions` - List discussions
- `POST /api/discussions` - Create discussion, authenticated
- `GET /api/reviews` - List reviews
- `POST /api/reviews` - Create review

### Users
- `GET /api/users/:username` - Get user profile

### Aggregation
- `GET /api/aggregate/packages` - Search npm with MCP filter
- `GET /api/aggregate/mcp/:name` - Get MCP package details
- `GET /api/aggregate/github/:owner/:repo` - Get GitHub repo data

### Other
- `GET /` - API info
- `GET /health` - Health check

## Deployment

```bash
# Login to Cloudflare
wrangler login

# Create D1 database
wrangler d1 create agora

# Run schema (replace YOUR_DATABASE_ID)
wrangler d1 execute agora --file=schema.sql

# Set secrets
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put AUTH_SECRET

# Deploy
wrangler deploy
```

## Local Development

```bash
# Install dependencies
bun install

# Run locally (requires D1 binding mock)
bun run dev

# Test
curl http://localhost:8787/health
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | Yes |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App secret | Yes |
| `AUTH_SECRET` | Secret for JWT/sessions | Yes |
| `AGORA_ENV` | `development` or `production` | No |

## Database Schema

Tables:
- `users` - User accounts with GitHub OAuth
- `packages` - MCP servers and plugins
- `workflows` - Shared agentic workflows
- `discussions` - Community discussions
- `discussion_replies` - Discussion replies
- `reviews` - Package/workflow ratings
- `tutorials` - Learning content
- `followers` - User relationships

See `schema.sql` for full schema.

## Authentication

GitHub OAuth flow:
1. User clicks "Login with GitHub"
2. Redirect to GitHub OAuth
3. Callback creates/updates user in DB
4. Session cookie set

CLI write endpoints also accept `Authorization: Bearer <github-token>`. The backend resolves the token against stored OAuth sessions first, then falls back to GitHub `/user` and upserts the user record. Protected write routes derive the author from that resolved user instead of trusting request body author fields.

Protected endpoints:
- `POST /api/packages`
- `POST /api/workflows`
- `POST /api/discussions`
- `POST /api/reviews`

## Status

✅ API code complete
⏳ Awaiting deployment
