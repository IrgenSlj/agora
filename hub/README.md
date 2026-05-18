# `agora` hub

Optional local web console for browsing the `agora` marketplace visually. The CLI is the primary product; the Hub is a companion surface for visual browsing and install-plan preview.

## Run

```bash
bun run hub:dev
# open http://localhost:4173
```

Static HTML / CSS / JS served by Bun. No build step. Uses `localStorage` + sample data — wire it to the backend in `../backend/` once that's hosted.

## Pages

- **Overview** — total packages / discussions / activity
- **Packages** — search, filter, sort the catalog; click through for metadata
- **Workflows** — prompt preview + install planning
- **Community** — discussion browsing + local moderation drafts
- **Install plan** — review selected items, preview generated `opencode.json`

## Status

Local-only. A public deploy is on the [roadmap](../ROADMAP.md) (Phase 5 — reach surface).
