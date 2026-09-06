# What to build next

Last prioritized: 2026-09-06.

This is the ordered implementation backlog. Current behavior is documented in
[`STATUS.md`](./STATUS.md); strategic phases are in [`../ROADMAP.md`](../ROADMAP.md); session
procedure and handoff are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

The trust spine is preserved. Consolidation means shared models and services, not deletion of
news/today, federation sources, host adapters, plugins, or MCP integration. Surfaces outside the
spine may be retired under brief DA-14; the shell, the prompter, local inference and the TUI pages
already were.

## Now — the feed is the product (DA-15)

A re-survey on 2026-09-06 found the post-install wedge occupied. Vercel shipped
`fingerprintTools`/`detectToolDrift` into the core `ai` package on 2026-07-09; `mcp-pin` arrived at
RFC 8785 + SHA-256 fingerprinting independently; PolicyLayer, MCPProxy, mcp-warden, MintMCP and
several gateways cover adjacent ground. Drift detection is now a commodity primitive and Agora will
not win it on distribution.

What the same survey did not find is **any advisory or known-bad feed for agent tooling**. There is
no CVE-equivalent, no revocation source, nothing a detector can ask "is this artifact known-bad?" —
and every detector needs that answer. That is the gap, it is data rather than code, and it turns the
competition into consumers.

So: **the feed is the product; the CLI is its reference client.** The four planes stay as the
architecture. Effort moves.

- [x] **FEED-001 — ingest the whole namespace.** The universe is the official registry walked in
  full: 13,400 servers, 3,257 npm artifacts, 31 entries across 20 packages including the first
  criticals. OSV moved to batched lookups (~30 requests, not ~3,300) and the walk retries a failed
  page rather than discarding everything behind it.
- [ ] **FEED-002 — model what OSV cannot.** OSV describes vulnerable *code*. The MCP-native classes
  are different and are the whole reason to exist: rug pulls, tool-description poisoning, repository
  transfer to a new owner, typosquats, abandonment. Each needs an entry kind, a severity rule, and a
  provenance field saying who asserted it and on what evidence.
- [ ] **FEED-003 — publish the format before the client.** A stable URL, a versioned JSON Schema,
  and a document another project can implement against without trusting Agora. Consumers adopting
  the schema *is* the distribution strategy; every integration reaches more people than a year of
  CLI installs would.
- [ ] **HOOK-001 — `PreToolUse` for Claude Code.** Detection without enforcement is advice. A
  host-native hook blocks on a feed hit or unapproved drift at the moment of the call, running on
  the user's machine with no service to operate — a gateway's placement without a gateway's cost.
- [x] **HOST-001 — close the VS Code blind spot.** `.vscode/mcp.json` and
  `~/.copilot/mcp-config.json` are read and written, with VS Code's own schema (`servers`, not
  `mcpServers`; explicit `type`; `inputs` and `sandbox` preserved). `.roo/mcp.json` is still
  unread — same shape as Cursor's, so it is cheap whenever Roo is worth the surface.
- [ ] **FED-RETIRE — Federate stops being discovery.** Keep it as identity resolution; the feed
  needs purl dedupe. Drop the ambition to be a search and browse surface against a registry with
  ~9,652 records and aggregators with 18,000+. Not a deletion — a narrowing of what it is for.

**This ordering is falsifiable.** Re-check it, do not defend it. It is wrong if OpenSSF or Anthropic
ship an MCP advisory database, if the official registry adds revocation to its API, if advisory
volume proves too low to curate, or if no second project adopts the schema within a quarter of
publishing it.

## Done — the CI wedge

Shipped, and still correct: repo-level MCP config turns out to be real and growing, and
`.mcp.json` / `.cursor/mcp.json` / `.vscode/mcp.json` / `.roo/mcp.json` are all documented as
commit-to-repo team-shared files. The wedge needs the feed behind it to be worth running, which is
what Now is for.

- [x] **REL-000 — ship 0.8.0.** Publish the revocation feed, `audit`, and the gate. Correct the
  Agent Skills claim. Lead all copy with the post-install promise (DA-13).
- [x] **CI-002 — `agora ci`.** One command that runs the whole post-install question and answers it
  once: advisories against configured servers, lockfile drift, and stack health. Single summary,
  one exit code on the existing contract, `--json`, and GitHub Actions annotations when
  `GITHUB_ACTIONS` is set. Unknowns stay unknown — a missing lockfile is reported as *not
  established*, never as clean.
- [x] **CI-003 — the Action.** `action.yml` at the repo root so `uses: IrgenSlj/agora@v0` works with
  no npm knowledge. Inputs for what to fail on; a job-summary table; annotations on findings.
- [x] **CI-004 — proof on a real repo.** Run it against this repository's own stack in CI, publicly.
  Agora holding Agora to its own standard is the demo.
- [x] **CI-005 — the `v0` tag.** `publish.yml` creates and moves it on release. It had never
  existed, so the README's one call-to-action errored for every reader.

## Later — the skills gap

Demoted from Now on 2026-09-05. The demand signal that made skills look urgent — roughly a fifth of
one marketplace's skills carrying malware — is an argument that *marketplaces* should scan, not that
a developer wants a second CLI for it. The copy no longer claims coverage, so nothing dishonest is
outstanding. Revisit when a user asks, or when the CI surface has an audience to ask.

- [ ] **SKILL-001 — skills through scan and the gate.** Give `agent-skill` a scan path (instruction
  hashing, injected-imperative heuristics) and route it through the same authorization kernel as
  `mcp-server`. No new gate semantics; one more artifact kind through the existing one.
- [ ] **SKILL-002 — skill drift.** Hash a skill's instruction body, diff across versions, and
  quarantine on change using the existing drift/quarantine machinery.
- [ ] **SKILL-003 — skill install and evidence.** Host adapters install/remove/quarantine skills;
  evidence records skills by purl like any other artifact.
- [ ] **REL-006 — publish 0.8.0.** Blocked on npm credentials. `bun run verify:package` is green,
  so the tarball is known to install and run; what remains is authentication and the release itself.
- [ ] **CI-005 — tag `v0` after publishing.** `action.yml` runs the published package, and `ci`
  landed in 0.8.0, so the tag the Action is consumed by must not exist before that release does —
  a `v0` pointing at an unpublished command is a broken Action with a good README. Order: publish
  0.8.0, verify `npx -y agora-hub@0.8.0 ci` on a clean machine, then `git tag -f v0 && git push -f
  origin v0`. The Action already fails with a legible version-mismatch error if this is done out of
  order.
- [ ] **REL-005 — let the feed bot publish.** Two repository settings block it. (a) `main` requires
  a status check named `backend` that no workflow produces — a leftover from the deleted Cloudflare
  backend — so with `strict: true` every non-admin push waits forever on a check that never
  reports. Remove the context. (b) Even then, a `GITHUB_TOKEN` push does not trigger the workflow
  that reports `check`, so the bot stays blocked: either drop required checks on `main` (they
  constrain nobody today — `enforce_admins` is false and there is one committer) or give the job a
  token that triggers workflows. Until one of those lands, the feed is only as fresh as the last
  release.
- [x] **FED-003a — search honesty.** `installs` is optional; absent means not measured. The
  stars-as-installs proxy is removed, and rows render only metrics their source published.
- [ ] **FED-003b — evidence-first ranking.** Rank by what Agora uniquely holds — signed, pinnable,
  no advisories — rather than by upstream popularity. Needs per-item evidence cheap enough for a
  list, so it waits on the evidence store being populated by acquisition.

## Then — security foundations

- [x] **SEC-001 — portable environment references.** `freeze` emits `env_from` names instead of
  host values; plan/apply resolve them locally and fail before writing when absent.
- [x] **OBS-001 — correct PID attribution.** Use `lsof -a -p PID -i -n -P` so network and PID
  selectors are intersected.
- [x] **OBS-002 — explicit sampler availability.** Missing/failed `lsof` is unavailable, not an
  empty successful sample.
- [ ] **SEC-002 — secret inspection.** Add reusable detection for manually authored manifest
  literals, credential-bearing URLs, sensitive command arguments, and diagnostics. Surface it
  through `agora doctor --secrets`; never echo the value.
- [ ] **OBS-003 — observation scope.** Record sampler platform/capability, inspect descendant
  processes, and ensure trust views say “sampled peers” rather than “all behavior.”
- [ ] **CLI-001 — typed exit results.** Map usage, policy/drift/revocation, network, and backend
  unavailability at one CLI boundary with command contract tests.

## Next — one gate for every mutation

- [x] **GATE-001 — mutation inventory.** Every active CLI entry point (including hidden compatibility
  aliases), MCP tool, and plugin tool has a machine-readable effect/gate/consent declaration.
  Completeness tests fail when a new surface is added without classification.
- [ ] **GATE-002 — central authorization service.** The pure decision kernel is implemented: deny
  dominates, missing/unknown required evidence is inconclusive, warnings require review, agents
  cannot authorize host/project/manifest writes or accept risk, and an accepted unknown is scoped
  and recorded. Scan, revocation, Cedar, and artifact-identity adapters drive acquire, approve,
  install, and try; provenance/drift still need first-class signals beyond their aggregate scan
  state.
- [x] **GATE-003 — route writes.** Every command that installs or runs an artifact is routed:
  acquire, approve, `install`, `try`, `apply`, `sync`, `update`, `integrate`, and MCP/plugin
  acquisition. The plugin config write is removed. `doctor --probe` is deliberately excluded and
  documented as such — quarantine only disables, and gating the fail-safe direction would let a
  denial keep a drifted server running. Every command and preview mode is preserved.
- [x] **GATE-004 — eliminate bypass semantics.** `--skip-scan` no longer skips the gate: it leaves an
  explicit unknown that only `--accept-risk` clears, revocation and Cedar always decide, a deny is
  never acknowledgeable, an agent can never acknowledge, and each acceptance is recorded in
  `gate-audit.jsonl`.
- [x] **GATE-005 — all-or-nothing tests.** Refused installs and try-runs are proven to leave the
  filesystem byte-identical, including the two-file `--save` case. Extend to each newly routed
  command as GATE-003 completes.

## Then — acquisition, lockfile, and evidence

- [ ] **EVD-001 — canonical artifact identity.** Establish one purl-first artifact type at the
  federation boundary and adapt older catalog types without losing source-specific fields.
- [~] **EVD-002 — acquisition transaction.** Mostly done; the bytes are resolved now. All of acquire's writes now run in one
  `FileTransaction` that restores every touched file if any step fails, and a failed rollback is
  reported rather than swallowed. Provenance is a first-class structured signal on `ScanResult`
  instead of a rendered check, and acquire records a real policy verdict with the hash of the policy
  files that produced it. `agora lock write` downloads and hashes each pinned tarball, so
  `tarball_sha256` records the bytes npm actually served and is cross-checked against npm's own
  published `dist.integrity`. **Still missing:** acquire itself can only build a lock entry when the
  upstream source published a tool list — today only Smithery does, which is off by default — so
  acquire tells the user to run `doctor --probe && lock write` rather than letting a successful
  install imply a baseline exists. Closing that needs either a canonical source that publishes
  tools, or a decision about probing at install time.
- [x] **EVD-003 — lock lifecycle.** `agora lock write` creates/updates the lockfile and the declared
  manifests it verifies against, deterministically serialized, refusing to lock drifted or
  quarantined servers. `lock verify` is unchanged and still reads older files.
- [ ] **EVD-004 — predicate schema registry.** Map every predicate type URI to a schema and reject
  invalid payloads before creating a DSSE envelope.
- [ ] **EVD-005 — runtime observation predicate v2.** Represent actual MCP session evidence rather
  than labeling it with the obsolete sandbox profile shape.
- [ ] **EVD-006 — clean-machine integration.** Acquire → lock → export → tamper → verify →
  quarantine, using packed artifacts and hermetic fixtures.

## Then — agent/human authorization

- [x] **AGENT-001 — request-only agent acquisition.** `agora mcp` preserves acquire preview and
  converts confirmation into an inert, evidence-bearing install intent; it returns `agora approve
  <id>` and cannot write host config or `agora.toml`. Plugin acquisition remains preview-only.
- [ ] **AGENT-002 — consent boundary.** Define and implement approval that an agent with ordinary
  tool access cannot self-assert. Document platform limitations honestly.
- [ ] **AGENT-003 — unified serve surface.** Complete policy-filtered search, evidence, policy
  check, and install request using the same domain services as the CLI.
- [ ] **AGENT-004 — packed-host verification.** Exercise OpenCode and Claude Code integrations from
  the installed tarball, including first-use permissions and stale plugin paths.

## Then — configuration and data integrity

- [ ] **CFG-001 — round-trip TOML edits.** Preserve comments, unknown keys/tables, and ordering in
  existing `agora.toml`; add adversarial preservation tests.
- [ ] **CFG-002 — concurrent atomic writes.** Replace fixed temporary paths with unique same-dir
  temporary files and verify cleanup/rename behavior under competing writers.
- [ ] **EVD-007 — store migrations.** Add explicit SQLite schema versions, migrations, and recovery
  tests; make CAS writes atomic.
- [ ] **REV-001 — revocation origin and freshness.** Keep bundled/fetched origin in matches,
  report bundled age, and distinguish independent verification from unsigned network additions.
- [ ] **FED-001 — catalog convergence.** Move all search/UI surfaces onto the canonical artifact
  model while retaining every supported source and compatibility adapter.
- [ ] **FED-002 — repair refresh automation.** Update JSON directly, validate schema and source
  timestamps, and fail when refresh produces implausible zero updates.

## Finally — release hardening and feature improvement

- [ ] **REL-001 — deterministic CI.** Pin action SHAs, Bun, Node, and npm; minimize workflow
  permissions.
- [x] **REL-002 — shipped-artifact tests.** `bun run verify:package` packs, clean-installs into an
  empty directory with an isolated `HOME`, and asserts the exit-code contract on the installed
  binary — including the three `agora ci` paths the GitHub Action depends on — plus that the schemas
  and revocation feed actually ship. Runs in CI on Linux and macOS. Run it before publishing.
- [ ] **REL-003 — platform matrix.** Minimum/current Node plus Linux, macOS, and Windows coverage for
  supported host paths.
- [ ] **REL-004 — supply-chain outputs.** npm provenance, SBOM, dependency review, and Agora's own
  committed evidence example.
- [ ] **UI-001 — trust-plane consistency.** Feed the same evidence/decision service into CLI, shell,
  `today`, plugins, and MCP so features remain while semantics stop drifting.
- [ ] **UI-002 — new improvements.** Add `agora why`, `agora diff`, richer policy-aware discovery,
  and stronger observation backends as foundations become ready.

## Definition of done

A checkbox closes only when:

1. the user-facing path is wired;
2. focused tests cover success, failure, and unknown states;
3. applicable `--json` and exit-code contracts are stable;
4. documentation states the exact achieved behavior without upgrading unknown to clean;
5. typecheck, lint, build, and the full test suite pass before release or PR.
