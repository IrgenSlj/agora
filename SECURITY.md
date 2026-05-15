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

## Known issues tracked for the next release

These are documented openly because Agora's whole thesis is that trust is the
product. They block the public backend deployment, not the standalone CLI:

- **Backend `requireUser` uses the raw GitHub OAuth token as the bearer
  credential.** Phase 2 rework will replace this with Agora-issued JWTs and
  hashed token storage. See `backend/src/index.ts` (`// SECURITY:` marker)
  and `ROADMAP.md` Phase 2.
- **Marketplace packages do not yet declare permission manifests.** Until the
  Phase 4 trust layer ships, `agora install <id> --write` runs `npm install -g`
  without surfacing what the package can touch. Treat installed MCP servers like
  any other dependency you would `npm i -g`.
