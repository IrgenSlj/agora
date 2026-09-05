# What to build next

Last prioritized: 2026-09-05.

This is the ordered implementation backlog. Current behavior is documented in
[`STATUS.md`](./STATUS.md); strategic phases are in [`../ROADMAP.md`](../ROADMAP.md); session
procedure and handoff are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

The overall feature set is preserved. Consolidation means shared models and services, not deletion
of the shell, TUI, news/today, inference, federation sources, host adapters, plugins, or MCP
integration. Only explicitly legacy surfaces may be retired.

## Now — the CI wedge

Agora's job, stated where it can be acted on: **fail the build when a tool you trusted changes.**
CI is the only place that question gets asked automatically, forever, by someone who has already
decided they care. Every primitive this needs already exists — `audit --json` exits 1 on a blocking
advisory, `lock verify` exits 1 on drift, `doctor --strict` exits 1 on a broken server and is
already documented "for CI/scripting". What is missing is one surface that composes them and a
distribution channel that has discovery, which npm does not.

- [x] **REL-000 — ship 0.8.0.** Publish the revocation feed, `audit`, and the gate. Correct the
  Agent Skills claim. Lead all copy with the post-install promise (DA-13).
- [x] **CI-002 — `agora ci`.** One command that runs the whole post-install question and answers it
  once: advisories against configured servers, lockfile drift, and stack health. Single summary,
  one exit code on the existing contract, `--json`, and GitHub Actions annotations when
  `GITHUB_ACTIONS` is set. Unknowns stay unknown — a missing lockfile is reported as *not
  established*, never as clean.
- [x] **CI-003 — the Action.** `action.yml` at the repo root so `uses: IrgenSlj/agora@v0` works with
  no npm knowledge. Inputs for what to fail on; a job-summary table; annotations on findings.
- [ ] **CI-004 — proof on a real repo.** Run it against this repository's own stack in CI, publicly.
  Agora holding Agora to its own standard is the demo.

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
- [ ] **REL-005 — let the feed bot publish.** Two repository settings block it. (a) `main` requires
  a status check named `backend` that no workflow produces — a leftover from the deleted Cloudflare
  backend — so with `strict: true` every non-admin push waits forever on a check that never
  reports. Remove the context. (b) Even then, a `GITHUB_TOKEN` push does not trigger the workflow
  that reports `check`, so the bot stays blocked: either drop required checks on `main` (they
  constrain nobody today — `enforce_admins` is false and there is one committer) or give the job a
  token that triggers workflows. Until one of those lands, the feed is only as fresh as the last
  release.
- [ ] **FED-003 — search honesty and ranking.** Stop printing `0 installs · 0 ★` for sources that
  supply neither. Rank by evidence Agora actually holds — signed, pinnable, no advisories.

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
- [ ] **EVD-002 — acquisition transaction.** Resolve immutable bytes, compute digest, validate the
  declared manifest, verify provenance, run the gate, persist evidence, update `agora.lock`, then
  write host config atomically or roll back.
- [ ] **EVD-003 — lock lifecycle.** Add create/update commands and deterministic serialization;
  preserve `lock verify` and backward-readable versions.
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
- [ ] **REL-002 — shipped-artifact tests.** Build, `npm pack`, clean-install, run CLI smoke tests,
  and validate schemas/evidence in CI.
- [ ] **REL-003 — platform matrix.** Minimum/current Node plus Linux, macOS, and Windows coverage for
  supported host paths.
- [ ] **REL-004 — supply-chain outputs.** npm provenance, SBOM, dependency review, and Agora's own
  committed evidence example.
- [ ] **UI-001 — trust-plane consistency.** Feed the same evidence/decision service into CLI, shell,
  TUI, `today`, plugins, and MCP so features remain while semantics stop drifting.
- [ ] **UI-002 — new improvements.** Add `agora why`, `agora diff`, richer policy-aware discovery,
  and stronger observation backends as foundations become ready.

## Definition of done

A checkbox closes only when:

1. the user-facing path is wired;
2. focused tests cover success, failure, and unknown states;
3. applicable `--json` and exit-code contracts are stable;
4. documentation states the exact achieved behavior without upgrading unknown to clean;
5. typecheck, lint, build, and the full test suite pass before release or PR.
