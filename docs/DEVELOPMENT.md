# Multi-session development guide

Agora is deliberately developed in coherent sessions. This document makes context durable so a new
session can continue without reconstructing intent from chat history or guessing from half-finished
code.

## Source-of-truth order

When documents disagree, use this order:

1. [`AGENTS.md`](../AGENTS.md) — repository invariants and working rules.
2. [`STATUS.md`](./STATUS.md) — what the current code can prove.
3. [`NEXT.md`](./NEXT.md) — ordered, actionable work.
4. [`ROADMAP.md`](../ROADMAP.md) — stable strategic phases.
5. [`AGORA_BRIEF_v2.md`](../AGORA_BRIEF_v2.md) — product intent plus dated amendments.
6. [`CHANGELOG.md`](../CHANGELOG.md) — what reached a release.

Historical text remains useful context, but it cannot promote a partial capability to live.

## Feature-preservation rule

Preserve Agora's overall concept and working functionality. Shell, TUI, `today`, inference,
federation sources, host adapters, plugins, MCP integration, policy, observation, and stack
management may be improved or consolidated; they are not deleted merely to shrink the codebase.

Removal is allowed only when a path is already obsolete, is explicitly declared legacy, and is
registered in `src/cli/retired.ts` with a migration message. Consolidation must retain the
user-visible capability.

## Session protocol

At the start of a session:

1. Read `AGENTS.md`, `STATUS.md`, `NEXT.md`, and the latest handoff below.
2. Run `git status --short`; preserve unrelated user changes.
3. Select the first unblocked work item in `NEXT.md` unless the user reprioritizes it.
4. Record the selected IDs in the working plan before editing.

During a session:

1. Work from general invariants toward specific integrations.
2. Add a failing focused test before or with every security-sensitive fix.
3. Keep migrations backward-readable where practical; never silently reinterpret persisted trust
   evidence.
4. Update `STATUS.md` only after a user-facing path and tests prove the capability.
5. Update `NEXT.md` checkboxes and this handoff before stopping.

At the end of a session:

```bash
bun run typecheck
bun run lint
bun run build
bun run test
git status --short
```

Run focused tests first. The full four-command gate is required before a release or PR; if a session
cannot run it, record exactly what ran and why.

## Work-item convention

Backlog IDs are stable across sessions:

- `SEC-*` — security boundaries and secret handling.
- `GATE-*` — authorization and mutation choke points.
- `EVD-*` — evidence, lockfile, predicates, and persistence.
- `OBS-*` — runtime observation.
- `CFG-*` — stack manifests and surgical writes.
- `FED-*` — federation and catalog data.
- `AGENT-*` — MCP/plugin/human approval boundaries.
- `REL-*` — CI, packaging, release, and platform verification.
- `DOC-*` — documentation truth and maintenance.

A completed item needs implementation, focused tests, and an updated status statement. A module
existing by itself is not completion.

## Latest handoff

### 2026-08-02 — hardening session 3

Intent: verify session 2's work, then close every remaining path to a write that skips the gate.

Corrected in session 2's own output (each test confirmed failing before its fix):

- `agora approve` re-resolved the request with a capability *query*, so approval could install a
  different item than the one reviewed. It now resolves by exact id, and the intent's recorded purl
  is a required `identity` signal — a changed package or version is refused, not installed.
- `agora approve` never passed `[policy] files`, so an agent-requested install was governed by
  fewer Cedar rules than a direct `agora acquire`. It now reads the project manifest.
- `--deny` was not a declared boolean flag, so `agora approve --deny <id>` consumed the id as the
  flag's value and listed pending requests instead of denying one.

Completed:

- `GATE-004`: `--skip-scan` is no longer a bypass. It leaves an explicit `unknown` scan signal that
  only `--accept-risk` clears; revocation and Cedar always decide, and a `deny` is never
  acknowledgeable. The kernel gained scoped acknowledgement, and agents cannot acknowledge at all.
- `src/gate/audit.ts`: every mutation that proceeded on an accepted unknown appends one line to
  `gate-audit.jsonl` (local accountability record, not signed evidence).
- `install --write` and `try` now run the same decision as `acquire` — scan, revocation, Cedar —
  where `install` previously had only a scan and `try` ran the artifact's code after any scan error.
- Closed the plugin `agora_config` write gap: `fix: true` computes and reports the repairs, and the
  kernel refuses the write because no agent can authorize a host-config mutation.
- Fixed a pre-existing crash in `extractPackageFromConfig`: an MCP entry without a `command` array
  threw, so `agora config doctor` crashed on exactly the config its `--fix` exists to repair.
- `GATE-005`: `test/gate/all-or-nothing.test.ts` pins that a refused install/try leaves the
  filesystem byte-identical, including the `--save` two-file case.
- `GATE-003` (most of it): `apply`/`sync` now gate a **local** manifest, not only `--from`. Only the
  network scan is reserved for remote sources; revocation and Cedar are offline and always run, so
  everyday local applies stay offline-capable. `update --write --yes` evaluates the version it is
  moving *to* and skips a refused entry with a reason rather than blocking the others.
- The manifest gate splits `name@1.2.3` out of the launch command before building the purl. Without
  it a pinned known-bad release only ever produced an unversioned advisory warning and was applied.
- A warning does not block `apply`/`sync` (CI has nobody to accept it, and one advisory must not
  stop every other server); `deny` and `inconclusive` still block everything.

Focused verification:

- `bunx vitest run test/gate/ test/approve.test.ts test/cli.test.ts test/plugin-config-tool.test.ts`
- `bun run typecheck`, `bun run lint`, `bun run build`, and full `bun run test` passed:
  1,772 tests passed, one skipped.

Next:

1. `GATE-003` remainder: `integrate` and `doctor --probe` are the last two unrouted writers.
2. `AGENT-002`: a consent boundary an agent with shell access cannot self-assert.
3. `SEC-002` secret inspection and `OBS-003` observation scope.

### 2026-08-02 — hardening session 2

Intent: make every write surface visible before routing behavior through one gate.

Completed:

- Pushed hardening session 1 to `origin/main` as `01a3b7e`.
- `GATE-001`: added `src/gate/mutations.ts`, classifying all 47 active CLI entry points (public
  commands plus compatibility/help routers), all five MCP tools, and all ten plugin tools by effect,
  consent, gate requirement, and honest current coverage.
- Completeness tests compare the inventory with actual CLI metadata/aliases and registered MCP/plugin
  surfaces. The first run caught `agora mcp` as an active hidden entry point.
- `GATE-002` foundation: added the pure authorization kernel. It implements deny dominance,
  inconclusive required evidence, warning review, and the request-only agent boundary.
- Added typed adapters for scan, Cedar, and revocation states. Primary `acquire` now records and
  enforces the shared decision while retaining human warning acceptance and dry-run behavior.
- `AGENT-001`: MCP acquire preview remains read-only; confirmation now creates only an inert,
  evidence-bearing install intent and returns `agora approve <id>`. Even confirmation plus warning
  acceptance cannot edit host config or `agora.toml`.
- Added focused all-or-nothing tests for clean/warning/failure evidence, actor authority, intent-only
  filesystem effects, and the in-memory MCP surface.

Focused verification:

- `bunx vitest run test/gate/adapters.test.ts test/gate/authorization.test.ts test/gate/mutations.test.ts test/acquire.test.ts test/gate/acquire-gate.test.ts test/serve-intent.test.ts test/serve-request.test.ts test/approve.test.ts test/mcp-server.test.ts`
- 63 tests passed.
- `bun run typecheck`, `bun run lint`, and `bun run build` passed.
- Full `bun run test` passed: 1,744 tests passed, one skipped.

Next:

1. Route `approve` through an explicit human-consent actor boundary and the same decision service.
2. Route `apply`/`sync` and update/install compatibility paths, then remove their bypass semantics.
3. Close the agent-callable plugin `agora_config` write gap.

### 2026-08-02 — hardening session 1

Intent: preserve all current non-legacy product surfaces, reconcile documentation, and begin with
the most general security failures.

Completed:

- `DOC-001`: established `STATUS.md`, a rewritten durable backlog, and this session protocol.
- `SEC-001`: generated portable manifests now use `[mcp.<name>.env_from]` references instead of
  copying host environment values. Missing references fail before config writes.
- `OBS-001`: network sampling now uses `lsof -a -p <pid> -i -n -P`.
- `OBS-002`: sampler failures are persisted as `unavailable`, never sampled-empty.

Focused verification:

- `bun run test test/stack/manifest.test.ts test/stack/freeze-cmd.test.ts test/stack/sync.test.ts test/observe.test.ts`
- 127 tests passed.
- `bun run typecheck` passed.

Full verification after documentation and implementation review:

- `bun run typecheck` passed.
- `bun run lint` passed.
- `bun run build` passed.
- `bun run test` passed: 1,723 tests, one skipped.

Next:

1. `GATE-001`: inventory every mutating command in a contract test and introduce the central gate
   service without removing commands.
2. `AGENT-001`: make agent-facing acquisition request-only while preserving human CLI acquisition.
3. `EVD-001`: connect acquisition to digest, store, and atomic lockfile creation.

Files in progress or intentionally deferred: none. Check `git status` for the session's uncommitted
changes before continuing.
