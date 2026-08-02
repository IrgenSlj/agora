# What to build next

Last prioritized: 2026-08-02.

This is the ordered implementation backlog. Current behavior is documented in
[`STATUS.md`](./STATUS.md); strategic phases are in [`../ROADMAP.md`](../ROADMAP.md); session
procedure and handoff are in [`DEVELOPMENT.md`](./DEVELOPMENT.md).

The overall feature set is preserved. Consolidation means shared models and services, not deletion
of the shell, TUI, news/today, inference, federation sources, host adapters, plugins, or MCP
integration. Only explicitly legacy surfaces may be retired.

## Now — security foundations

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
- [ ] **GATE-003 — route writes.** Acquire, approve, `install`, `try`, `apply`, `sync`, `update`,
  and MCP/plugin acquisition are routed; the plugin config write is removed. Remaining: `integrate`
  and `doctor --probe`. Preserve every command and preview mode.
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
