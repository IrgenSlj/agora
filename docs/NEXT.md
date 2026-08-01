# What to build next

Written 2026-07-31, the day `agora-hub@0.7.0` reached npm. `ROADMAP.md` is the authority on what
is *live*; `CHANGELOG.md` is the authority on what *shipped*; this document is the authority on
what to do *next* and why in that order.

## A number worth correcting

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

**This is not a failure to distribute. It is pre-launch, on purpose.** The owner's stated intent
(2026-07-31): Agora doubles as an educational project, it goes public when it is genuinely worth
marketing, and there is no timeline. So "nobody uses it" is a *fact to stop mis-citing*, not a
problem to solve this week — earlier documents treated 117 installs a month as an audience and
reasoned from it, and that was the actual error.

What it does change: **stop ranking work by proximity to adoption.** There is no funnel to
optimise yet. Rank instead by the owner's actual goals — *make the thing genuinely good, and
learn something building it*:

1. **Is it true?** Claims the product makes about itself must hold. This outranks everything.
2. **Does it stay cheap?** One maintainer. Anything needing weekly attention is a future lie.
3. **Is it interesting to build?** Explicitly a criterion, not a guilty pleasure — learning is
   half the point of this project.
4. **Would it matter on the day this goes public?** Not "does it get users now."

Distribution work is listed last not because it is unimportant but because it is *not yet due*.

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
which argued the revocation feed would be hard for anyone else to copy. It would not be: OSV is
public and anyone can query it. What is actually distinctive is the *surface* — knowing which npm
packages are MCP servers, and looking in host config files, where no other tool looks. (Being
copyable is a mild concern anyway for a project with no competitors and a learning goal; it is
noted here to keep the reasoning honest, not because it should drive decisions.)

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

- ~~`npm deprecate opencode-agora`~~ — **done 2026-07-31.** npm now serves the deprecation notice
  pointing at `agora-hub`.
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

- ~~Wire npm trusted publishing (OIDC)~~ — **done 2026-07-31** (owner). Configured on npmjs.com
  against this repo and `publish.yml`. **Unverified until a release actually runs through it** —
  the first thing to check after the next publish is whether `npm view agora-hub dist.attestations`
  returns something.
- Then **dogfood it**: commit Agora's own evidence bundle
  (`agora export --attestations`) into the repo and regenerate it on release. It is simultaneously
  the proof, the demo, and the worked example the format spec needs.

This is the cheapest credibility available and it doubles as documentation.

## 2a. Why the feed has no signing key *(decided 2026-07-31)*

Recorded because it will look like an omission otherwise, and because the reasoning took two
passes to get right.

The original design pinned an ed25519 public key in the binary and signed the feed with the
private half. That was dropped. The key would have lived as a GitHub Actions secret **in the same
repository that serves the feed**, so whoever could rewrite the feed could usually sign it too —
it bought authenticity against a narrow attacker while leaving the realistic one untouched, and
cost a permanent key-custody obligation.

What replaced it stops the attack that actually matters (**suppression** — an entry quietly going
missing):

- The feed **ships inside the npm package**, so it is covered by that package's provenance
  attestation, and is authoritative.
- A fetched copy is merged **monotonically** (`src/revocation/merge.ts`): it may add entries and
  may never remove, weaken, or outrank one.

`test/revocation-merge.test.ts` is the security argument, including the subtler suppression routes.
The ed25519 path stays implemented and tested — a signature is still the only way to *withdraw* an
entry between releases, which is the one thing bundling cannot do.

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

**Shipped and live.** `src/osv/`, `scripts/sync-feed.ts` and `.github/workflows/sync-feed.yml`
run daily; the first run found 10 advisories across 5 catalog packages.

**No signing key is needed, and none should be minted.** That requirement was removed rather than
satisfied — see §2a. Revocations apply today.

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

**Shipped 2026-07-31** as a separate verb — the name rhyming with `npm audit` is worth more than
the tidiness of one fewer command. Verified side by side in one directory against a real
lockfile: `npm audit` → 0 vulnerabilities, `agora audit` → 8 advisories across 3 servers.

## 5. Distribution — when it is due, not before

**No code. Deliberately last.**

This is a pre-launch project by choice; going public happens when the owner judges it worth
marketing. Recording the options now so the decision is ready when that day comes, rather than
improvised:

- **List on the official MCP Registry.** Where people already look for MCP tooling.
- **Write the `npm audit` piece** — §4 is the demo, `not_established` is the philosophy, and the
  two GHSA advisories on the flagship server are the hook. This is the highest-leverage artifact
  available and it needs no code.
- **Tell the MCP server maintainers whose packages carry advisories.** A useful, non-promotional
  message that happens to demonstrate the product.
- **The OpenCode and Claude Code communities**, where the audience is definitionally people who
  run MCP servers.

§2–§4 are the prerequisites: they are what makes the pitch true rather than aspirational. There
is no rush on this section, and no reason to treat a quiet npm graph as a verdict on the work.

## 6. `agora gate` — probably already exists under other names

**Checked 2026-07-31, and largely redundant.** `agora policy check --ci` already evaluates every
installed artifact against Cedar and exits non-zero; `agora audit` does the same for advisories;
`agora quarantine` exits 1 when anything is held back. A `gate` command would be a wrapper over
three commands that already work.

What it would genuinely add is a *single* CI entry point, which is a real documentation and
adoption argument rather than a technical one — "put `agora gate` in your pipeline" beats a
three-command incantation. ~30 lines if it is wanted. Not built, deliberately, because adding
surface that duplicates working commands is the opposite of the maintenance posture here.

## 7. Cut the TUI

`src/cli/tui.ts` + `src/cli/pages/` is **3,590 lines** outside the v2 brief — a second UI for
things the CLI already does, and a surface every trust-plane change has to be threaded through
(wiring plane verdicts in during C5 meant doing the work three times).

**Keep** the shell (`src/cli/shell/`, 1,630 lines) and `src/inference/` (351). The zero-mode-switch
shell with free inference on first run is a real onboarding argument and costs a fraction as much.

Reversible via git, so this is a judgement call rather than a risk. Stop adding to the TUI now.

## 8. S7 — `agora serve`, the agent-facing surface — **IN PROGRESS**

The only one of Agora's five planes that does not exist. Discovery filtered through *policy*, so
an agent only ever sees artifacts it is permitted to install.

**Built and tested (2026-07-31):**

- `src/serve/intent.ts` — the install-intent record. An agent may *ask*; only a human may install.
- `agora approve` — the human half, reviewing requests and re-running the real gate.

**Not built yet — this is where to pick up:**

- `src/serve/` MCP server hosting four tools: `search_tools` (capability search filtered through
  Cedar's `Serve` action), `get_evidence` (the `agora trust` rows as structured data, unknowns
  included), `check_policy` (dry-run a decision), `request_install` (writes an intent via
  `writeIntent`, returns `agora approve <id>`, **mutates nothing**).
- `agora serve` to host it. `src/cli/mcp-server.ts` is the pattern to follow.
- When it exists, restore the `agora serve` mention in `approve`'s help text in
  `src/cli/commands-meta/stack.ts` — it was reworded because the dangling-command guard correctly
  refuses to advertise a command that does not exist.

- `search_tools` — capability search, results filtered through Cedar's `Serve` action
- `get_evidence` — the `agora trust` rows as structured data, `unknown` states included
- `check_policy` — dry-run a decision without acting
- `request_install` — writes an *intent* and prints `agora approve <id>`. **Never mutates the
  stack.** This is the load-bearing constraint: an agent that could install its own tools is the
  attack this product exists to prevent.

`src/cli/trust-view.ts` is already the right shape for `get_evidence`, and it now includes a real
revocation row.

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

## Release policy *(set 2026-07-31)*

**Version stays at 0.7.0 and the changelog accumulates under `[Unreleased]`.** The next release
comes when several fronts are ready together, not when one lands — the owner's call, and it
matches a long-standing preference for sculpting heavily before shipping.

Practically: do not bump manifests as a matter of course. A manifest claiming a version npm does
not serve is the same drift that cost this project a failed release. Pick the number on the day,
and it is more likely to be 0.8.0 than 0.7.1.

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
