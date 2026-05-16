# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.4.x   | :white_check_mark: |
| 0.3.x   | :white_check_mark: (security fixes only) |
| < 0.3   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please do NOT open a public issue.
Instead, send a private report to the project maintainers via GitHub's
[private vulnerability reporting](https://github.com/IrgenSlj/agora/security/advisories/new).

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact

You should receive a response within 48 hours. If the vulnerability is accepted,
a fix will be prioritized and a security advisory will be published.

## Security Best Practices

- API tokens and credentials are stored in `~/.config/agora/state.json` with user-only permissions
- Sensitive data (tokens) are never logged or exposed in error messages
- All file writes use atomic operations to prevent partial writes
- The bundled offline data contains no secrets or credentials
- Auto-installable packages are validated against the npm registry — entries without a published `npmPackage` remain browsable but cannot be installed

## Authentication model

Agora uses an OAuth-style token pair on every authenticated backend request:

- **Access token** — stateless JWT (HS256), 1h lifetime. Carried as
  `Authorization: Bearer <token>`. Verified by signature + `exp` only; no
  per-request DB lookup.
- **Refresh token** — JWT with a random `jti`, 90d lifetime. The server
  stores `sha256(jti)` keyed by `user_id` in `refresh_tokens`. Every call to
  `POST /auth/refresh` rotates: the old `jti` row is deleted and a fresh
  pair is issued, so a leaked refresh token is single-use.
- **Logout** — `POST /auth/logout` revokes either one refresh token
  (passed in the body) or all of the user's refresh tokens (logout
  everywhere). `agora logout` calls this best-effort before clearing local
  state, so a network failure still removes the credentials locally.
- **GitHub** — used only for identity binding (`users.github_id`); the
  GitHub OAuth access token is never persisted.

The CLI stores the pair in `~/.config/agora/state.json` (user-only perms).
Tokens are masked in `agora auth status` output and never logged.

## Known issues tracked for the next release

These are documented openly because Agora's whole thesis is that trust is the
product:

- **Marketplace packages do not yet declare permission manifests.** Until the
  Phase 4 trust layer ships, `agora install <id> --write` runs `npm install -g`
  without surfacing what the package can touch. Treat installed MCP servers like
  any other dependency you would `npm i -g`.
- **Redundant rate-limit check on `/api/*` write endpoints.** Each write
  flows through both the `/api/*` middleware and an inline `checkRateLimit`
  call, against different keys. Functionally correct (both buckets must
  permit), but burns two DB writes per request. Cleanup tracked for the
  deploy-readiness pass.
- **`/api/*` rate-limit keying by auth-header prefix.** The middleware keys
  authenticated requests by `auth.slice(0, 16)` — the first 16 chars of
  `Bearer eyJ...`, which is identical for every JWT from the same secret.
  In practice this collapses to per-IP keying for all authed traffic.
  Pre-existing; replace with per-user keying derived from the verified JWT
  `sub` claim during the deploy-readiness pass.
