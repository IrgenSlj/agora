# `agora` hub

Web console for browsing the `agora` marketplace visually. The CLI is the primary product; the Hub is a companion surface for visual browsing and install-plan preview.

## Run locally

```bash
bun run hub:dev
# open http://localhost:4173
```

Static HTML / CSS / JS served by Bun. No build step. Uses `localStorage` + sample data when offline; connects to the backend API when reachable.

## Deploy to Cloudflare Pages

```bash
# 1. Deploy the backend first (see ../backend/README.md)
# 2. Set the API URL in your Pages dashboard:
#    Environment variable: AGORA_API_URL = https://your-worker.example.com
# 3. Connect this directory to Cloudflare Pages via the dashboard or CLI:

npx wrangler pages deploy . --project-name agora-hub
```

The hub auto-detects the backend API. Set `AGORA_API_URL` in the browser via a `?api=` query param, or hardcode it in `api-client.js`.

## Pages

- **Overview** — total packages / discussions / activity
- **Packages** — search, filter, sort the catalog; click through for metadata
- **Workflows** — prompt preview + install planning
- **Community** — discussion browsing + local moderation drafts
- **Install plan** — review selected items, preview generated `opencode.json`

## Architecture

- `api-client.js` — fetch wrapper that calls the backend API (`/api/packages`, `/api/workflows`) with sample-data fallback
- `app.js` — UI logic, uses `livePackages()` / `liveWorkflows()` which resolve to API data if available, bundled samples otherwise
- `index.html` — single-page layout shell
