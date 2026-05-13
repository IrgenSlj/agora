# Roadmap

A snapshot of where Agora is headed. Issues labeled `good-first-issue` and `help-wanted` on GitHub are the easiest places to jump in.

## Near term (0.3.x)

- **Demo recording.** Asciinema/VHS recording of `agora init` for the README.
- **Dependabot enabled.** Weekly bump of npm + GitHub Actions.
- **Marketplace data refresh script.** Re-pulls latest npm metadata (version, downloads) for every MCP server in `src/data.ts` so the offline snapshot stays current.
- **"Last refreshed" stamp** on bundled data so users know how fresh it is.
- **Manual plugin registration docs.** A short guide for users who skip `agora init`.

## Mid term (0.4 – 1.0)

- **Hosted backend.** Deploy `backend/` to a public Cloudflare Workers endpoint so `--api`, publish, reviews, and discussions work out of the box.
- **Docs site.** Move long-form docs out of README into a small Starlight/VitePress site under `docs/`.
- **Hub deploy.** Public web Hub for browsing the marketplace.
- **Tutorial expansion.** Add tutorials for more common MCP setups (Postgres, Playwright, S3).
- **Contributor guide for data.** Step-by-step for adding an MCP server, workflow, or tutorial to the offline data.

## Ideas / exploring

- Plugin auto-update channel.
- Telemetry (opt-in) for which MCP servers people actually install — informs ranking.
- VS Code / JetBrains extension that surfaces Agora marketplace from the IDE.
- `agora doctor` for full-environment diagnostics, not just config.

## How to help

- **Add an MCP server to the offline marketplace.** See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **Write a tutorial.** New tutorials live in `src/data.ts` under `sampleTutorials`.
- **Report a setup that `agora init` misses.** Open an issue with your project's manifest files.
- **Try the live API mode against a self-hosted backend.** Feedback on rough edges welcomed.

_Last updated: 2026-05-13_
