# What to build next

Written 2026-07-31, the day `agora-hub@0.7.0` reached npm. `ROADMAP.md` is the authority on what
is *live*; `CHANGELOG.md` is the authority on what *shipped*; this document is the authority on
what to do *next* and why in that order.

## The fact that reorders everything

**Agora has approximately zero human users.** Measured 2026-07-31, not assumed:

| Signal | Value | Reading |
|---|---|---|
| npm downloads | 103 on publish day, then 0–3/day | Mirrors and scanners pulling a new version |
| GitHub stars / forks / watchers | 0 / 0 / 0 | — |
| Repo page views | 22 views, **1 unique** | Nobody is looking |
| Clones | 484 from 140 "uniques" | CI and crawlers, not people |

The ~123 downloads/month that earlier planning documents treated as an audience is one
publish-day spike plus noise. This was never checked; it was inferred from a number that looked
like adoption and was not.

**So the constraint is not "does anyone care."** Nobody has been given the chance to. It is
distribution, and it has been all along — hidden behind three months of build work that always
felt more urgent.

Everything below is ranked against a single test: **does this either make the product's claim
true and checkable, or put it in front of someone?** Work that presupposes users — retention
features, agent-facing surfaces, maintenance reduction — is deferred, not because it is bad but
because it optimises a funnel with no traffic.

## The claim, sharpened

> **Your agent runs code that `npm audit` can't see. Agora audits it.**

This is the positioning, and it is structurally true rather than a slogan. MCP servers live in
`opencode.json` and host configs as *spawned commands* — `npx @modelcontextprotocol/server-filesystem`
— and are never declared in any `package.json`. npm audit, Dependabot and Snyk are blind to them
by construction: they audit dependency trees, and this is not one.

Verified 2026-07-31: `npm audit` over a tree containing `agora-hub` reports **0 vulnerabilities**,
while OSV reports **two GHSA advisories** against `@modelcontextprotocol/server-filesystem` — a
server that a developer may well be running right now.

That gap is the product. It also corrects an error in the previous version of this document,
which sold the revocation feed as a data moat. It is not: OSV is public and anyone can query it.
**The moat is the surface, not the data** — knowing which npm packages are MCP servers, and
looking at a place nothing else looks.

Two standing rules that decide most arguments here:

- **Least maintenance wins.** One person maintains 32k lines. A feature that needs weekly human
  attention is a feature that will be stale in a month and lying by month three.
- **Inference may describe a verdict, never produce one.** An LLM deciding whether a package is
  malicious is "scores, not evidence" — nondeterministic, unauditable, unexportable. Every gate
  stays deterministic: Cedar, hashes, signatures, OSV. Inference is for *explaining* what the
  deterministic layer already decided.

---

## 1. Consolidate on `agora-hub` — one name, one package

**Decided 2026-07-31.** `opencode-agora` is retired. Everything ships as `agora-hub`.

The two names had quietly become two *products*: what sat on npm as `opencode-agora@0.4.5` was
never the thin re-export the repo described — it was a standalone pre-pivot plugin with its own
dependency tree and no reference to `agora-hub` at all. It had roughly as many downloads as
`agora-hub` itself, meaning about half of Agora's users were running May's code with none of the
trust plane, and no upgrade path pointed anywhere.

Done already:

- `packages/opencode-agora/` deleted; `publish.yml` publishes one package.
- `agora init` no longer writes `plugin: ["opencode-agora"]`. It had been wiring every scaffolded
  project to that stale package and pinning them there.

Still to do:

- **`npm deprecate opencode-agora "renamed → agora-hub; see npm agora-hub"`** (owner action). This
  is the only thing that reaches the people still on 0.4.5.
- **Restore a working OpenCode plugin path.** This needs a decision, because it is not free:

  OpenCode resolves plugin specifiers as npm package names, `file://` URLs, or absolute/relative
  paths — **not** subpath exports, so `"plugin": ["agora-hub/opencode"]` cannot work. That leaves
  two options, and both have a real cost:

  | Option | Cost |
  |---|---|
  | Export the plugin from the package root so `"plugin": ["agora-hub"]` resolves | `src/index.ts` is the *library* surface. Re-exporting the plugin makes `import('agora-hub')` require `@opencode-ai/plugin`, which is an optional peer — library consumers without it would break. |
  | `agora integrate` writes an absolute `file://` path to the installed plugin entry | Machine-specific path; wrong in a committed project `opencode.json`, fine in host-level config. |

  Leaning toward the second, scoped to host-level config only. **Verify against a live OpenCode
  before shipping either** — see the note below about what that verification already turned up.

**Note, and a live bug:** OpenCode has been failing to load Agora's plugin on the developer's own
machine since 2026-07-28 — `~/.config/opencode/opencode.json` points at
`file:///Users/admin/agora/dist/index.js`, which is the library root and exports no plugin. The
log shows a `failed to load plugin` error on every run. Whatever specifier is chosen, `agora
integrate` should write it rather than leaving it hand-maintained.

**OpenCode inference is unaffected and stays.** `src/inference/opencode.ts` spawns the `opencode`
binary and is the zero-cost default that makes the shell work with no API key on first run. That
is a separate mechanism from the plugin and one of the better arguments for installing Agora at
all.

## 2. Make Agora verifiable by Agora

**Cheap, and it closes a hole in the core claim.**

`agora-hub@0.7.0` shipped with **no provenance attestation**, because it was published from a
laptop and npm can only attest builds it runs itself. So `agora trust agora-hub` would report
*"no published attestation"* about Agora — a supply-chain tool that cannot demonstrate its own
supply chain. Every argument this product makes is weaker while that is true, and it is the first
thing a security-minded reader will check.

- Wire npm trusted publishing (OIDC) so the next release goes through `publish.yml` and carries
  `--provenance`. Owner action, browser-only, free.
- Then **dogfood it**: commit Agora's own evidence bundle
  (`agora export --attestations`) into the repo and regenerate it on release. It is simultaneously
  the proof, the demo, and the worked example the format spec needs.

This is the cheapest credibility available and it doubles as documentation.

## 3. Automate the revocation feed from OSV — make the invisible surface visible

**The item that turns the positioning above into working software, with no ongoing human attention.**

Revocation is the one capability nothing else in this ecosystem has, and it is currently inert: no
key is pinned, so every feed reads `unverifiable` and no revocation applies. Both halves are now
built (`feed/`, `scripts/sign-feed.ts`) — what was missing was *content*, and the answer is not to
curate it by hand.

[OSV.dev](https://osv.dev) already does the curation, for free, and **speaks purl** — the same
identifier Agora's data model uses. Verified 2026-07-31:

- `POST /v1/query` accepts `{"package": {"purl": "pkg:npm/…"}}` directly.
- `POST /v1/querybatch` handles the whole catalog in one call, scoped packages included.
- No API key. No rate limits.
- Carries `MAL-*` malware advisories from the `ghsa-malware` feed.
- `@modelcontextprotocol/server-filesystem` — the flagship MCP server — has two open GHSA
  advisories right now. The feed would not be empty on day one.

**Design:** a scheduled GitHub Action reads every MCP server purl in the catalog, batch-queries
OSV, maps severity (`MAL-*` → critical, GHSA high/critical → high, rest → advisory), signs, and
commits. Zero curation, zero cost, no inference. If it breaks it fails loudly and clients keep the
last signed feed.

**What makes this Agora's and not a mirror of OSV:** OSV knows about npm packages. Agora knows
*which npm packages are MCP servers*. That intersection — the advisory feed for the MCP ecosystem
— is a thing nobody publishes, generated automatically.

**Honest limit to encode in the UI:** this is *known-bad*, never *safe*. A novel malicious server
nobody has reported yet will not appear. Same rule as everywhere else in the product.

Blocked only on minting the signing key (`feed/README.md`, owner action, ~1 hour).

## 4. `agora audit` — the one command that demonstrates the gap

**The smallest artifact that makes the positioning self-evident, and the thing to point people at.**

Today, proving the claim takes a paragraph. It should take a command:

```
$ npm audit
found 0 vulnerabilities

$ agora audit
⚠ @modelcontextprotocol/server-filesystem  2 advisories (GHSA-hc55-p739-j48w, GHSA-q66q-fx2p-7w4m)
  configured in ~/.config/opencode/opencode.json — not in any package.json,
  which is why npm audit cannot see it.
```

Mechanically it is `agora doctor`'s host-config discovery joined to the OSV lookup from §3 — a
thin command over machinery that will already exist. Its value is not technical; it is that the
side-by-side is the entire argument, reproducible by a stranger in thirty seconds.

Whether this is a new verb or a flag on `doctor` is an open question. A separate name that
deliberately rhymes with `npm audit` is probably worth more than the tidiness of one fewer command.

## 5. Put it in front of someone

**The actual constraint. No code.**

Zero users is not a product problem — nothing about the trust plane is missing. It is that the
product has never been shown to anyone. Cheapest first:

- **List on the official MCP Registry.** Where people already look for MCP tooling.
- **Write the `npm audit` piece** — §4 is the demo, `not_established` is the philosophy, and the
  two GHSA advisories on the flagship server are the hook. This is the highest-leverage artifact
  available and it needs no code.
- **Tell the MCP server maintainers whose packages carry advisories.** A useful, non-promotional
  message that happens to demonstrate the product.
- **The OpenCode and Claude Code communities**, where the audience is definitionally people who
  run MCP servers.

Do §2–§4 first so there is something true to point at. But do not let build work keep deferring
this again — that is the pattern that produced three months of planes nobody has seen.

## 6. `agora gate` — the CI wedge *(deferred: presupposes users)*

One command that evaluates every installed artifact against the project's Cedar policy and exits
non-zero on failure. Cheap: the policy engine, the lockfile, and the trust view all exist; this is
mostly wiring plus an exit-code contract.

The reason it matters is retention. A developer who tries a CLI may never run it twice; a team
with it in their pipeline cannot casually remove it. This is the shortest path from "interesting
tool" to "load-bearing".

## 7. Cut the TUI *(deferred: produces no information)*

`src/cli/tui.ts` + `src/cli/pages/` is **3,590 lines** outside the v2 brief — a second UI for
things the CLI already does, and a surface every trust-plane change has to be threaded through
(wiring plane verdicts in during C5 meant doing the work three times).

**Keep** the shell (`src/cli/shell/`, 1,630 lines) and `src/inference/` (351). The zero-mode-switch
shell with free inference on first run is a real onboarding argument and costs a fraction as much.

Reversible via git, so this is a judgement call rather than a risk. Stop adding to the TUI now.

## 8. S7 — `agora serve`, the agent-facing surface *(deferred: presupposes agent users)*

The largest remaining piece of the brief, and the most future-proof: discovery filtered through
*policy*, so an agent only ever sees artifacts it is permitted to install.

- `search_tools` — capability search, results filtered through Cedar's `Serve` action
- `get_evidence` — the `agora trust` rows as structured data, `unknown` states included
- `check_policy` — dry-run a decision without acting
- `request_install` — writes an *intent* and prints `agora approve <id>`. **Never mutates the
  stack.** This is the load-bearing constraint: an agent that could install its own tools is the
  attack this product exists to prevent.

`src/cli/trust-view.ts` is already the right shape for `get_evidence`.

**Skip the embeddings.** The brief specifies `@xenova/transformers` + `sqlite-vec`; that is a large
model download on first run to improve recall nobody has complained about. The existing BM25 index
(`src/search/catalog-index.ts`) proves the shape.

Deferred below the items above because it serves agents that do not exist yet, while 2–4 serve
users who do.

## 9. Smaller, still worth doing

- **`agora doctor --secrets`** (brief §9) — flag plaintext API keys in host configs with
  `file:line` and a keychain/env remediation hint. Small and obviously useful.
- **`agora why <artifact>`** — plain-language explanation of which Cedar rule decided and which
  evidence attribute drove it. The diagnostics are already structured; this is the one place
  inference earns its keep, because it *describes* a verdict it did not produce.
- **`agora diff <artifact>`** — "what changed since I approved this?". `evidence/diff.ts` already
  detects schema drift; this promotes it to the question users actually ask at upgrade time.
- **Windows verification.** The stack adapters and `opencode-exec.ts` have Windows handling that
  has never run on Windows. Either test it in CI or say plainly in the README that it is unverified.

## Explicitly not doing

- **A hosted backend.** Non-negotiable in `AGENTS.md`. The Cloudflare Worker scaffold was deleted
  on 2026-07-31 — the revocation feed is a signed file in git, which is strictly better: no
  domain, no account, no bill, and nothing that fails when someone else's server does.
- **`agora-hub.dev`.** Not needed. Attestation predicate types use the URI as an identifier, which
  does not have to resolve.
- **The Docker sandbox `vet`.** Replaced by runtime observation. `ObservedProfile` is unchanged, so
  a pre-install backend can be added later if a real need appears.
- **Canary tokens.** Dropped with the sandbox; they need a callback endpoint on a domain that does
  not exist.
- **Semantic search.** See §8.
- **Hand-curated advisories.** See §3 — if it needs weekly human attention it will be stale in a
  month, and a stale advisory feed is worse than none.
- **Anything with recurring spend** until there is a reason.

## How to work on this

- **Everything lands on `main`, pushed often.** CI green at every push.
- **Verify against the built binary, not the tests.** This has now caught real bugs in three
  consecutive sessions — a duplicate `observe` command, an evidence bundle that silently dropped
  planes, and an `engines.node` claim the dependency tree could not honour.
- **Check the published artifact, not the config that produced it.** Installing the packed tarball
  into a clean project is what surfaced the Node 20 claim and the missing plugin peer dependency.
- **Absence of evidence is never a positive finding.** The product's whole differentiator and the
  easiest thing to erode by accident. `src/cli/trust-view.ts` documents the rule;
  `test/cli/trust-view.test.ts` and `test/evidence-bundle.test.ts` enforce it per plane.
