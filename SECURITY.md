# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

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
