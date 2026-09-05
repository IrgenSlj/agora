# Agora roadmap

Agora catches **the tool that changed after you trusted it**. That is the promise the product leads
with (brief amendment DA-13); "trust plane" remains the accurate description of the architecture
underneath it. The security guarantees are made true end to end, and every step ships to npm.

Use [`docs/STATUS.md`](./docs/STATUS.md) for current capability truth,
[`docs/NEXT.md`](./docs/NEXT.md) for actionable work, and
[`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) for multi-session handoffs. The locked intent and
dated design amendments remain in [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md).

## Direction

Agora will continue to provide:

- federated MCP and Agent Skill discovery;
- provenance, schema, description, and runtime evidence;
- Cedar policy, revocation, audit, quarantine, and trust views;
- portable stack management across OpenCode, Claude Code, Cursor, and Windsurf;
- a CLI, plugins, and MCP integrations;
- local-first operation with no required hosted backend.

The shell, TUI, local inference, and the `today` command are scheduled for retirement (DA-14). The
news pipeline behind `today` survives as a published weekly digest.

Features may be consolidated behind shared services and models. Preservation applies to the trust
spine — federate, verify, gate, manage — plus the host adapters, plugins, and MCP integration.
Surfaces outside that spine may be retired through the explicit retired-command mechanism with a
named reason (brief amendment DA-14). The daily-digest *pipeline* is retained; it is published
rather than shipped as a command.

## Ordering principle

Release comes first. Finished, unshipped work is a defect: it cannot be used, cannot be corrected by
anyone else, and cannot teach us anything. After that, work proceeds from the broadest invariant to
the narrowest integration:

0. Ship what is already finished, and keep shipping weekly.
1. Protect secrets and correct false evidence.
2. Make one gate authorize every mutation.
3. Make acquire produce immutable identity, evidence, and lock state atomically.
4. Make evidence export schema-valid and independently consumable.
5. Complete the human/agent authorization boundary.
6. Unify federation and persistence models without losing sources or interfaces.
7. Harden individual hosts, UI surfaces, packaging, and release automation.
8. Add new capabilities only on top of those foundations.

## Phase 0 — release

Status: **in progress (0.8.0)**.

- Publish the revocation feed, `agora audit`, and the authorization gate, finished on `main` since
  2026-08-02 and absent from npm since.
- Correct the Agent Skills claim: skills are federated into search and pass through no trust plane.
- Lead all copy with the post-install promise (DA-13).
- Hold a weekly release cadence thereafter, including for small changes.

Gate: what the README describes is what `npm i -g agora-hub` installs.

## Phase A — security invariants

Status: **in progress**.

- Portable manifests reference environment variables instead of copying host values.
- Runtime connection sampling is PID-constrained and has an explicit unavailable state.
- Add secret detection for manually authored manifest literals, URLs, command arguments, logs, and
  diagnostics.
- Define typed CLI failures so policy, usage, network, and unavailable-backend exit codes are
  consistent.

Gate: no known path can serialize a credential into a portable artifact, and unavailable evidence
cannot be presented as a clean result.

## Phase B — one authorization choke point

Status: **in progress**. The mutation inventory, decision kernel, scan/revocation/Cedar adapters,
and primary acquire routing are live; the remaining mutating commands still need migration.

- Introduce a central authorization service over scan, provenance, drift, revocation, and Cedar.
- Route `acquire`, legacy-compatible `install`, `apply`, `sync`, `update`, `approve`, plugins, and
  MCP writes through it.
- Keep preview and plan modes read-only.
- Replace write-bypass flags with explicit, auditable risk decisions where policy permits them.

Gate: a contract test enumerates every mutating command and proves it cannot write after a deny,
inconclusive policy result, revocation hit, or drift block.

## Phase C — artifact transaction and evidence truth

Status: **partial foundations exist**.

- Use one canonical purl-first artifact model from federation through policy and export.
- Resolve immutable bytes and digest before a write.
- Store declared manifest, provenance, observations, and decisions by artifact digest.
- Atomically create/update `agora.lock` as part of acquisition.
- Validate each exported predicate against its named schema.
- Preserve explicit `not_established` entries for every missing plane.

Gate: a clean-machine integration test performs acquire → lock → export → tamper → verify →
quarantine with no fabricated evidence.

## Phase D — human and agent boundaries

Status: **partial request-only flow is enforced**. MCP acquire confirmation creates an inert intent,
never a stack write; terminal approval is not yet a strong consent boundary against shell-capable
agents.

- Consolidate the current MCP and planned serve surfaces without losing search, evidence, status,
  plan, or request functionality.
- Agent tools may search, inspect, check policy, plan, and request installation.
- Only a real user-consent boundary may approve the write.
- Keep human CLI acquisition as a supported feature.
- Keep OpenCode and Claude integrations thin and backed by the same services.

Gate: an agent-callable interface cannot complete its own installation, including by supplying a
confirmation boolean or invoking an equivalent plugin path.

## Phase E — configuration, federation, and persistence

Status: **live but fragmented**.

- Make `agora.toml` editing round-trip preserving for comments, unknown tables, keys, and ordering.
- Add SQLite migrations and concurrency-safe CAS/atomic temporary writes.
- Converge `Artifact`, `FederatedItem`, and older catalog types without dropping sources.
- Repair automated JSON catalog refresh and retain only source-attributed metrics.
- Preserve shell, TUI, `today`, inference, host adapters, and all non-legacy commands while moving
  them onto shared domain services.

Gate: one evidence repository and one artifact identity serve every UI and integration, with
backward-readable migrations.

## Phase F — release and platform hardening

Status: **planned**.

- Pin CI actions and tool versions.
- Run build, schema validation, pack, clean install, and CLI smoke tests in CI.
- Test the minimum and current Node versions and Windows host paths.
- Verify npm provenance and dogfood `agora trust agora-hub` after release.
- Produce an SBOM and validate the shipped tarball, not merely the source tree.

Gate: a tagged release is built once by CI, installed from the packed artifact on supported
platforms, and verifies its own provenance.

## Later capabilities

These remain in the concept and may be developed after the foundations above:

- a pre-install sandbox or stronger OS-specific runtime observation backend;
- `agora why` and `agora diff` explanations over deterministic evidence;
- a single CI-oriented `agora gate` command over existing checks;
- richer TUI/shell trust workflows and policy-aware discovery;
- additional host adapters, registries, and evidence producers.

They remain local-first, deterministic at the decision layer, and subject to the same honest-output
rules.
