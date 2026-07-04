# Frozen surface

This directory is a marker, not a home for code. It documents what's **frozen** per
`AGORA_BRIEF.md` D3/D4/D11: not part of the current pitch ("the system manager for your agentic
stack"), and — as of the repo-cleanup pass — actually removed from the working tree, not just
excluded from the build. Frozen means "not actively developed or shipped right now," not "gone
forever": everything below is recoverable from git history (`git log --diff-filter=D -- <path>` to
find the deleting commit), and reviving any of it is a deliberate future decision, not an accident
of someone forgetting it exists.

## What's frozen (and removed)

- **`backend/`** — the Cloudflare Worker that used to back the community API (auth device flow,
  boards/threads/reviews/profiles). Had zero TypeScript importers anywhere in `src/`. Deleted along
  with its `typecheck:backend` script and the CI `backend` job.
- **`hub/`** — the web app front-end for the same backend. Also had zero importers from `src/`.
  Deleted along with `docker-compose.yml`, which only orchestrated backend+hub.
- **Our own community boards** — the discussion/thread/reply/vote/flag/admin surface that used to
  live in `src/cli/commands/community.ts`, `src/cli/pages/community.ts`, and `src/community/**`.
  The CLI commands (`community`, `thread`, `post`, `reply`, `vote`, `flag`, `admin`, `discussions`,
  `discuss`) and the community TUI page were removed in the P-freeze pass (see CHANGELOG).
  `src/community/**` (the board fixtures/client) had no remaining importers and was deleted in the
  repo-cleanup pass that followed.
- **Account-write commands** — `publish`, `review`, `reviews`, `profile` (all API writes against the
  frozen backend) were removed alongside the community boards, since they had the same dependency.

## What's NOT frozen

- **`AGORA_API_URL` / `auth` / `src/state.ts`** — the auth token store and API-URL resolution are alive
  and still used by `src/live/search.ts`, which reads the live marketplace API when configured and
  degrades to offline data when it isn't. Don't confuse "the community backend is frozen" with "all API
  access is frozen" — they're different endpoints on the same worker, and only the community ones are
  dead.
- **`news`** — the Ring-3 "plaza" reader survives as `src/cli/commands/news.ts`, extracted out of the
  old `community.ts` file it used to share. It reads HN, GitHub Trending, and arXiv (Reddit was dropped
  separately — closed OAuth, killed endpoints, brief D5).
- **`src/federation/**`, `src/inference/**`, `src/stack/**`, `src/hubs/**`** — active development
  surfaces, untouched by the freeze.

## Reviving something here

If a future decision un-freezes any of this, expect to: recover the deleted directories/files from
git history, re-wire the CLI dispatch table and `commands-meta` entries (deleted, not just hidden),
re-add the TUI page registration, and check whether the backend/hub code has drifted from the rest
of the stack in the meantime — it hasn't been typechecked as part of CI since well before this
removal pass.
