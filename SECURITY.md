# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.4.x | yes |
| 0.3.x | security fixes only |
| < 0.3 | no |

## Reporting a vulnerability

Do **not** open a public issue. Use GitHub's [private vulnerability reporting](https://github.com/IrgenSlj/agora/security/advisories/new) with a description, reproduction steps, and impact assessment. Expect a response within 48 hours.

## How `agora` handles user data

- `~/.config/agora/state.json` (saves + auth tokens), `settings.toml`, `preferences.json`, `news-meta.json`, and the hub enrichment store are written **atomically** (`.tmp` + `renameSync`) at **`0o600`** via the shared `src/atomic-write.ts` helper. A crash mid-flush leaves the previous file intact.
- Tokens are masked in `agora auth status` output and never logged.
- The bundled offline catalog contains no secrets.
- Auto-installable packages are validated against the live npm registry by the test suite; entries without a published `npmPackage` are marked browsable-only.

## Install consent (Phase 4 trust step 1)

Items in the catalog can declare a `permissions: { fs?, net?, exec? }` manifest. When present:

- **TUI install preview** flips its footer from `y confirm` to `g grant + install   d details   n cancel`.
- **CLI `agora install <id> --write`** refuses without `--yes`, prints the manifest, and exits 1.
- **CLI `agora install <id> --write --yes`** prints `Granted permissions:` followed by the manifest before any `execSync` runs.

The manifest is currently **informational** — there is no runtime sandbox yet. Treat installed MCP servers like any other dependency you would `npm i -g`. Runtime enforcement is open Phase 4 work; see [`ROADMAP.md`](./ROADMAP.md).

## Authentication model

`agora` uses an OAuth-style token pair on every authenticated backend request:

- **Access token** — stateless JWT (HS256), 1h lifetime. Carried as `Authorization: Bearer <token>`. Verified by signature + `exp` only; no per-request DB lookup.
- **Refresh token** — JWT with a random `jti`, 90d lifetime. The server stores `sha256(jti)` keyed by `user_id` in `refresh_tokens`. Every `POST /auth/refresh` rotates: the old row is deleted and a fresh pair is issued, so a leaked refresh token is single-use.
- **Logout** — `POST /auth/logout` revokes either one refresh token or all of the user's tokens (logout everywhere). `agora logout` calls it best-effort before clearing local state.
- **GitHub** — used only for identity binding (`users.github_id`); the GitHub OAuth access token is never persisted.

## Moderation

`agora admin hide` and `agora admin log` are gated by a `requireAdmin` middleware that checks the caller's user id against the comma-separated `AGORA_ADMIN_USER_IDS` env on the backend. Every kill-switch use is recorded in the public `kill_switch_log` table per [`COMMUNITY_GUIDELINES.md`](./COMMUNITY_GUIDELINES.md). Community-side moderation is flag-don't-delete: items with ≥3 flags auto-collapse, ≥10 flags auto-hide.

## Recent hardening

- Shell-injection paths reviewed and switched to `execFileSync` / `spawnSync` with args arrays: `$EDITOR` open, OAuth `verificationUri` browser open, `git clone` install kind (also gated by a URL allowlist at plan-build time)
- arXiv news source switched from `http://` to `https://`
- Backend write endpoints (`POST /api/packages|workflows|discussions`) have length caps; `/api/community/threads` validates `?sort=` against an explicit allowlist before SQL interpolation
- OAuth device-code + token responses are narrowly typed and validated for required fields

## Known issues tracked for the next release

- **Redundant rate-limit check on `/api/*` write endpoints.** Each write flows through both the `/api/*` middleware and an inline `checkRateLimit` call. Functionally correct (both buckets must permit) but burns two DB writes per request.
- **`/api/*` rate-limit keying by auth-header prefix.** The middleware keys authenticated requests by `auth.slice(0, 16)` — `Bearer eyJ...` is identical for every JWT from the same secret. Collapses to per-IP keying for all authed traffic. Replace with per-user keying derived from the verified JWT `sub` claim during the deploy-readiness pass.
