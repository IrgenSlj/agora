# Agora roadmap

**Direction: LOCKED** by [`AGORA_BRIEF_v2.md`](./AGORA_BRIEF_v2.md) — Agora is **the trust plane
for agentic tooling**. Phase-by-phase execution lives in
[`docs/NEXT.md`](./docs/NEXT.md); that document is the *how*, the brief
is the *what*.

Verified external-API corrections live in [`docs/OPEN_QUESTIONS.md`](./docs/OPEN_QUESTIONS.md);
shipped work is in [`CHANGELOG.md`](./CHANGELOG.md). **What to build next, and why in that
order, is [`docs/NEXT.md`](./docs/NEXT.md).**

## What's live today (v0.7.0, published to npm 2026-07-31)

- **Manage** — stack manager (`src/stack/`): `agora.toml` profile, per-host adapters (OpenCode,
  Claude Code, Cursor, Windsurf), `plan`/`apply`, `sync --from <url>`, `doctor` with drift,
  quarantine system for drifted/quarantined servers.
- **Multi-source search** — offline-first catalog search (`agora search`), deduped by purl, with
  honest per-source status. Eight adapters exist; **four query by default** (official MCP Registry,
  Glama, GitHub, skills-github) alongside the bundled local catalog. PulseMCP is disabled (no
  self-serve API — see `docs/OPEN_QUESTIONS.md` OQ-3); Smithery and Hugging Face are non-canonical
  and opt-in behind `AGORA_ENABLE_NONCANONICAL_SOURCES`. A source that cannot answer reports
  `unreachable` with a reason and falls back to its cache — it never reports an empty result as
  success. Glama's upstream endpoint currently 504s.
- **Verify** — schema hashing (`evidence/schemahash.ts`), schema drift (`evidence/diff.ts`),
  tool-description poisoning checks (`evidence/enrich.ts`), and **live Sigstore provenance**
  (`evidence/sigstore.ts`): Fulcio chain, CT log and Rekor inclusion, with the signing
  certificate's identity bound to the repository the provenance claims. `agora scan
  mcp-filesystem` reports `✓ Signed provenance — signed by modelcontextprotocol/servers`.
  Requires Node (the shipped runtime); under `bun run` it degrades to "could not check" rather
  than reporting a false failure.
- **Gate** — the heuristic customs gate on `agora acquire` (injection-pattern, drift, permission,
  poisoning checks) **plus** a real Cedar policy evaluated over that evidence. `agora policy
  init|check|test`, `[policy] files` in `agora.toml`, and a shipped baseline that forbids only
  what is known-bad. `check` lints before evaluating, because a Cedar rule reading a missing
  attribute is silently skipped and returns permissive. `acquire` refuses on deny **and** on
  inconclusive — an allow reached with rules switched off is not an allow.
- **Revocation — live.** Entries are generated from OSV.dev daily with no human curation
  (`src/osv/`, `scripts/sync-feed.ts`); the feed ships *inside the npm package* and a fetched copy
  is merged monotonically, so it can add revocations but never remove one
  (`src/revocation/merge.ts`). **No signing key is needed** — that requirement was removed rather
  than satisfied, because the key would have lived in the same repo as the feed. `acquire` refuses
  confirmed critical/high matches before any write; an advisory whose version range cannot be
  confirmed against the artifact warns instead of blocking.
- **Integration** — `agora mcp` (MCP server exposing the stack + catalog as tools),
  `agora integrate --all` (installs Agora into every host via its own stack machinery).
- **Surface** — the v1 catalog commands (`auth`, `curate`, `chat`, `trending`, `workflows`,
  `tutorials`, `save`/`saved`/`bookmarks`, `similar`, `compare`, `share`, `author`, `use`, `menu`)
  were removed in v0.6.2 along with `src/auth/` and `src/curator/`. There are no accounts and no
  stored credentials anywhere in the product.
- **Observe** — `agora run -- <command…>` supervises an MCP server during real use and records
  what it did (`src/observe/`); `agora observe` reports it. The shim is byte-transparent and
  records tool *names* and counts only — never arguments, results, or prompt text.
- **Interactive** — `agora` with no arguments opens a shell where a terminal command, an `agora`
  command, or plain text (→ chat) all work without a mode switch; `agora tui` is the full-screen
  browser. Inference is spawned, never hosted: `opencode` is the zero-cost default so it works
  with no key on first run.

- **Trust view** — `agora trust <id>` shows every plane's verdict at once, including what is
  *not* known: no published attestation is not a failed signature, an allow reached with Cedar
  rules skipped is not a permit, an uncached revocation feed is not "not revoked", and a server
  never run has not been shown to behave. Rendered in the TUI item and acquire pages too.
- **Quarantine CLI** — `agora quarantine [list]` and `agora unquarantine <name> --accept-risk`.
- **Advisories** — `agora audit` checks every configured MCP server against OSV.dev and exits
  non-zero on a malware/critical/high finding. `agora trust` shows the same advisories per
  artifact, distinguishing a confirmed hit from "this package has advisories but your version is
  not pinned, so it is unknown whether they apply". This is a surface nothing else covers: MCP servers
  are spawned commands in host configs, never declared dependencies, so `npm audit`, Dependabot
  and Snyk cannot see them by construction. The revocation feed is filled from the same source by
  `scripts/sync-feed.ts` on a daily schedule — 10 real advisories across 5 catalog packages on
  the first run, and no human curation anywhere in the loop.
- **Exportable evidence** — `agora export --attestations <id>` emits an in-toto/DSSE bundle: a
  statement per plane that produced evidence, and an explicit `not_established` entry for every
  plane that did not. Unsigned by design (`tier: "none"`) — Agora has no attestation-signing
  identity. Format specified in [`docs/EVIDENCE.md`](./docs/EVIDENCE.md); the 39 generated JSON
  Schemas now ship in the npm package under `schemas/`.

Not yet live: the agent-facing `agora serve` discovery tools (S7), and a pre-install sandbox (S6
shipped as runtime observation instead). **This section is the authority on what is live**; README,
AGENTS.md and docs/ARCHITECTURE.md were realigned to it on 2026-07-28.

**Everything below `0.7.0` on npm is unreleased.** The version is held at 0.7.0 deliberately and
the changelog accumulates under `[Unreleased]`; the next release ships several fronts at once.
So the trust plane described here is *on main* — the revocation feed, `agora audit`, `agora
approve` and the evidence export have **not** reached users yet.

**`agora-hub@0.7.0` is live on npm as of 2026-07-31** — the first release carrying the trust
plane. Getting there took repairing a release path that had never once succeeded: every publish
run back to v0.2.2 had failed, and both versions previously on npm were pushed by hand.

Two consequences worth knowing. **0.7.0 has no provenance attestation**, because it was published
from a laptop and npm can only attest builds it runs itself — so Agora currently cannot verify
Agora, and the next release must go through `publish.yml`. And **`opencode-agora` is retired**: it
had drifted into a separate pre-pivot product with its own users, and everything is `agora-hub`
now (see `docs/NEXT.md` §1).

## Phase status

| Phase | Name | Status |
|-------|------|--------|
| S0 | Hygiene & identity | ✅ Complete |
| S1 | Data model & lockfile | ✅ Complete |
| S2 | Multi-source search | ✅ Complete |
| S3 | Provenance & drift | ✅ Complete — live Sigstore verification wired |
| S4 | Revocation | ✅ Complete — OSV-fed, bundled, monotonic; no key required |
| S5 | Policy (Cedar) | ✅ Complete — engine, `agora policy`, acquire gate |
| S6 | Vet → **Observe** | ✅ Complete — observation, policy wiring, and `observe enable/disable` |
| S7 | Serve (agent-facing) | 🔄 Intent + `agora approve` built; MCP server not started |
| S8 | Launch hardening | 🔄 Evidence export, schemas and format spec shipped 2026-07-31 |
| C1–C6 | Consolidation (audit 2026-07-27) | ✅ Complete 2026-07-28 |

## Remaining plan

**[`docs/NEXT.md`](./docs/NEXT.md) is the authority on what to build next and why in that order.**

It opens with a number worth correcting: the "~117 installs a month" earlier documents treated as
an audience was mirror and scanner traffic. Agora has approximately zero human users — which is
**pre-launch by design**, not a failure. This project doubles as an educational one and goes
public when it is judged worth marketing.

So work is ranked by *is it true · does it stay cheap · is it interesting to build · would it
matter on launch day* — not by proximity to adoption. Order: consolidate on `agora-hub`, make
Agora verifiable by Agora, automate the feed from OSV, ship `agora audit`, then `agora gate`, the
TUI cut, and S7. Distribution is listed last because it is not yet due.

Sizing note: `src/` is ~32k lines maintained by one person. The four planes plus the stack manager
account for roughly a third; the rest is CLI surface, which is what the cleanup items are about.

Three guards now fail the build rather than relying on review, and are worth knowing about
before changing anything near them:

- `test/setup.ts` blocks real network access. The suite was silently making live HTTP calls;
  every network call takes an injectable `FetchLike` (`src/fetch.ts`) and forgetting to pass
  one is now a loud failure.
- `test/cli/no-dangling-commands.test.ts` greps every user-facing `agora <cmd>` string against
  the real registry. Four cleanups in a row had found code advertising deleted commands.
- `test/cli/trust-view.test.ts` pins one honesty rule per plane — each is a collapse of
  "unknown" into "ok" that would otherwise be tempting.

Verify with `bun run test && bun run typecheck && bun run lint && bun run build`.

### C1 — Delete the v1 remnants the pivot left behind (~1,600 lines)

Three separate things, in ascending order of care required.

**C1a — `src/live/` (619 lines). Safe, and not what the old plan claimed.** This entry
previously read "changes `agora install` behaviour — owner sign-off before starting."
That is **wrong**, and the correction matters. `src/live/search.ts:18` gates every API
call on `shouldUseApi = useApi && apiUrl`; `apiUrl` comes only from `--api-url` or
`AGORA_API_URL`, with **no default**. `agora-hub.dev` is unregistered and the Worker scaffold
is a four-file scaffold serving different routes (`/v1/catalog`, not `/api/trending`).
So every call in practice takes the `offline(...)` branch straight to the bundled
catalog. **`src/live/` is a client for a server that has never existed.** Deleting it and
calling the bundled catalog directly is behaviour-preserving; the only loss is an
undocumented `--api-url` escape hatch that points at nothing.

**C1b — dead v1 community symbols.** 200 exports are never imported outside their own
file; most are types, but a real cluster is the community backend that brief D6 deleted:
`mapDiscussion`/`mapTutorial`/`mapReview`/`mapProfile` (`live/internal.ts`),
`formatReviewList`/`formatTutorialList`/`formatTutorialStep` (`cli/format.ts`),
`SavedItem`/`removeItemFromState`, `writeSourceOptions`/`readSourceOptions`. Confined to
seven files.

**C1c — `src/marketplace.ts` is *not* legacy; it needs renaming, not deleting.** The old
entry lumped its 671 lines into the kill list. But `MarketplaceItem` is the item type used
by `scan.ts`, `acquire.ts`, `federation/adapters/local.ts`, and `cli/commands/observe.ts`.
It is the bundled-catalog reader and it stays. Rename it to say so
(`src/catalog/bundled.ts`) rather than carrying commerce-era vocabulary into v2. Also
retires the third artifact kind: `workflow` is live in 11 files and 12 catalog entries,
but brief D8 locks exactly two kinds (`mcp-server`, `agent-skill`).

### C2 — Make the docs stop contradicting the code

Not drift — inversion. `docs/ARCHITECTURE.md` states "Sigstore online verification …
is **not wired**" (shipped in S3) and "`src/policy/` does not exist" (shipped in S5), and
maps `src/federation/sources/` barrels that were deleted. `AGENTS.md` calls Verify and
Gate "planned." README's status table marks S3/S4/S5 as 🔜. All three still promise a
*sandboxed* `vet` and *canary-token* detection — both dropped when S6 was reshaped into
runtime observation. A contributor reading these builds the wrong thing.

### C3 — Inference providers: opencode + Claude (decided 2026-07-27)

Agora ships a built-in free inference reference so the shell works with no key on first
run, and the shell treats any non-command input as a chat opportunity. That stays.
`opencode` remains the zero-cost default; Claude becomes the bring-your-own upgrade.

**Build it as an exec shim, not an SDK integration** — see `docs/OPEN_QUESTIONS.md` OQ-1,
corrected. Spawning `claude -p --output-format json` uses whatever auth the developer's
Claude Code already has, **subscription included**, and Agora never sees a credential.
That is strictly better than OQ-1's original API-key adaptation and is the only version
consistent with "Agora stores no credentials."

- Extract a `Provider` interface from `src/opencode-exec.ts` (the `resolveOnPath` and
  Windows `.cmd` handling are already generic).
- `providers/opencode.ts` (default) and `providers/claude.ts`, detected by PATH.
- Flag mapping: `run --format json` → `-p --output-format json`; `--model opencode/<id>`
  → `--model <alias>`; `--session <id>` → `--resume <id>`; `--continue` → `-c`.
- Use model **aliases** (`opus`, `sonnet`, `haiku`, `fable`), not pinned IDs. OQ-1's
  pinned `claude-opus-4-8` is already stale — that is the argument.

### C4 — Shrink news to `agora today` (decided 2026-07-27, ~950 lines)

Brief D6 retains the feed "read-only with zero new investment" and §9 lists only
`agora today`. Today the codebase also carries an `agora news` command and an 817-line
news TUI page — the largest single page in the repo, and the opposite of zero investment.
Keep `src/news/` sources + scoring feeding `agora today`; drop the duplicate command and
the page.

### C5 — Wire the interactive surface to the trust plane

The TUI (4,412 lines) and the chat shell (2,837) are **kept** — decided 2026-07-27. The
shell's zero-mode-switch model (terminal command, `agora` command, or plain text → chat)
and built-in free inference are deliberate product, not debt.

The real gap is that neither knows the trust plane exists. `src/cli/shell/main.ts:5`
imports `getMarketplaceItems` — the v1 bundled catalog — and there is no import from
`evidence/`, `policy/`, `revocation/`, or `observe/` anywhere in `src/cli/shell/`. The
best-designed, highest-touch surface currently shows catalog rows where it should show
verdicts. This is the cheapest place to make evidence visible, and it is what converts
those 7,249 lines from cost into the product's face.

### C6 — Close the brief §9 gaps ✅ done 2026-07-28

`agora quarantine [list]`, `agora unquarantine <name> --accept-risk`, `agora remove`, and
`verify` as an alias for `scan`. The quarantine machinery had shipped and was enforced by
`sync`/`update`, but with no CLI the only exit was hand-editing `capabilities.json`.

`test/cli/no-dangling-commands.test.ts` now fails the build when any user-facing string
names a command that is not registered. Four cleanups in a row had turned up the same bug —
v0.6.2 deleted commands but not the code pointing at them — and the guard caught two more
on its first run (`agora watch` documented an example using the deleted `agora trending`;
the shell's `/u` shortcut still ran `agora use`).

### S6 remainder

**Observed divergence into policy — ✅ done 2026-07-28.** `divergence_max` now means what
the baseline always claimed: the worst divergence between what an artifact *declared* and
what it was *observed doing*. It is absent until behaviour has been recorded, so a policy
guarding with `has` never treats an unwatched server as a well-behaved one. The
scan-derived value moved to `scan_max`. That mattered twice over: the policy plane was
grading the heuristic it was built to replace, and because policy is evaluated before the
scan-fail gate, a failing scan surfaced to the user as a *policy denial*.

**Still unbuilt:** `agora observe enable/disable` — rewriting host configs to insert the
`agora run --` shim. Wiring is manual today
(`command = ["agora","run","--", …]`).

### S7 Serve (1 wk)

`src/serve/` — the agent-facing MCP server. `search_tools`, `get_evidence`,
`check_policy`, `request_install`, with results filtered to `permit` only. Depends on S5
(done) and is much more useful after the S6 remainder.

### S8 Launch hardening (1 wk)

`PRIVACY.md`, a comprehensive `agora doctor`, docs site, and the 2.0.0 release. The
remaining breaking changes land here; the 19 retired commands shipped in 0.7.0.

---

### Owner-gated — none of this is blocked on code

| | What | Why it is blocking |
|---|---|---|
| 1 | Mint the revocation feed key (`bun scripts/generate-feed-key.ts`) | Until a public key is pinned, every feed is `unverifiable` and **no revocations apply**. S4's client half is inert without it. |
| 2 | Register `agora-hub.dev` (~$12/yr) | The feed endpoint, canary callbacks, and attestation predicate URLs all hardcode it. Blocks S4's publishing half and S6's canaries. |
| 4 | Upload `docs/assets/social-preview.png` | Settings → Social preview. The API cannot set it. |
| 5 | Commission the five README diagrams | The brief was deleted 2026-08-01; rewrite it if the diagrams are wanted. |
| 6 | **Publish 0.7.0** — create a GitHub Release for `v0.7.0`; `publish.yml` fires on it and publishes with `--provenance` | **This is the binding constraint on the whole product, and it costs nothing.** `agora-hub@0.6.1` is live and taking ~117 installs/month, but it is the *pre-pivot catalog tool*: Sigstore, Cedar, revocation and observation have all shipped to `main` and never to a user. Version, changelog and the 19 retired-command messages are ready; only the Release is outstanding. |

## Execution conventions

- Everything lands on `main`, pushed often (owner directive) — phase gates are readiness
  checkpoints, not branch boundaries; `main` stays green at every push.
- Contract-first: load-bearing interfaces authored centrally; mechanical/parallelizable work fans
  out to sonnet implementer agents.
- Non-negotiables (see `AGENTS.md`): local-first, honest output, agent-operable (`--json`, stable
  exit codes per brief §9), surgical config writes, thin plugins, terminal degradation, no creds
  in `agora.toml`.
