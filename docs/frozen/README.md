# Frozen surface

This directory is a marker, not a home for code. It documents what's **frozen** in this repo per
`AGORA_BRIEF.md` D3/D4/D11: kept around (nothing here is deleted from disk), but excluded from the
default build/typecheck path and not part of the current pitch ("the system manager for your agentic
stack"). Frozen means "not actively developed or shipped right now," not "gone" — reviving any of this
is a deliberate future decision, not an accident of someone forgetting it exists.

## What's frozen

- **`backend/`** — the Cloudflare Worker that used to back the community API (auth device flow, boards/
  threads/reviews/profiles). Zero TypeScript files anywhere in `src/` import from it. Its `typecheck`
  script (`typecheck:backend`) still exists in `package.json` but is no longer part of `bun run
  typecheck` — run it explicitly if you're working in `backend/`.
- **`hub/`** — the web app front-end for the same backend. Also zero importers from `src/`.
- **Our own community boards** — the discussion/thread/reply/vote/flag/admin surface that used to live
  in `src/cli/commands/community.ts`, `src/cli/pages/community.ts`, and `src/community/**`. The CLI
  commands (`community`, `thread`, `post`, `reply`, `vote`, `flag`, `admin`, `discussions`, `discuss`)
  and the community TUI page were removed in the P-freeze pass (see CHANGELOG). `src/community/**`
  itself (the board fixtures/client) is left in place, unused, in case any of it is worth salvaging
  later — it has no remaining importers either.
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

If a future decision un-freezes any of this, expect to: re-wire the CLI dispatch table and
`commands-meta` entries (both deleted, not just hidden), re-add the TUI page registration, and check
whether the backend/hub code has drifted from the rest of the stack in the meantime — it hasn't been
typechecked as part of CI since this freeze landed.
