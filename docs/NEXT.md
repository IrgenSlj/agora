# What to build next

Written 2026-07-28, after S0–S6 and the C1–C6 consolidation. `ROADMAP.md` is the authority on
what is *live*; this document is the authority on what to do *next* and, more usefully, why the
order is what it is.

One rule governs everything below: **the product's value is gated by whether anyone can use it,
not by how much of it exists.** Agora spent three months building four planes that no user has
ever seen, because the published package is still the pre-pivot catalog tool. Every item here is
ranked by distance to a user, not by how interesting it is to build.

---

> **Update 2026-07-30.** §0 and §1 were both written on a wrong assumption, found by checking
> rather than reading. §0 said publishing was purely an owner action with everything prepared —
> in fact the release *was* cut on 2026-07-29 and the workflow **failed**, as had every publish
> run in the project's history, back to v0.2.2. The repo has never had an npm credential. §1's
> blocker was likewise not a decision but a domain nobody had registered, which turned out not
> to be needed at all.
>
> Fixed since: the publish workflow's `bun test` panic, version drift across four manifests, a
> shell-injection vector in the same file, and the revocation feed's entire publishing half
> (`feed/`, signed from git — no domain, no server). What genuinely remains owner-only is now
> two credentials: npm auth, and the feed signing key.

## 0. Publish 0.7.0 — the only thing that matters this week

**Owner action. Costs nothing. Blocks everything.**

`agora-hub@0.6.1` is live on npm and taking ~117 installs a month. It predates the trust plane:
Sigstore verification, the Cedar engine, the revocation client, runtime observation, `agora trust`
and `agora observe enable` have all shipped to `main` and **never to a user**.

Everything is prepared — version bumped, changelog finalised, all 19 removed commands give a real
message. Create a GitHub Release for `v0.7.0`; `publish.yml` fires on it and publishes with
`--provenance`.

Until this happens, every item below is worth exactly zero to anyone.

---

## 1. Pin a revocation key (owner) — turn on the differentiator

**Owner action. Costs nothing but a decision.**

Revocation is the thing no other tool in this ecosystem has, and it is currently **inert**: no
public key is pinned, so every feed reads `unverifiable` and no revocation applies. The client
half is done and tested; the plane produces `unknown` on every lookup, which the UI honestly
reports and which is worth very little.

1. `bun scripts/generate-feed-key.ts`
2. Public key → `PINNED_FEED_KEYS` in `src/revocation/feed.ts`, shipped in the next release
3. Private key → a CI secret

A feed can then be published as a signed JSON file in this repo — **no domain and no server
required**, served from raw.githubusercontent.com. That is worth doing precisely because it
removes the dependency on `agora-hub.dev`, which has been "blocking" for weeks without moving.

**Do this before S7.** A trust plane whose most distinctive capability is switched off is a
weaker demo than one with three working planes and an honest gap.

---

## 2. `src/serve/` — S7, the agent-facing MCP server

**~1 week. The largest remaining piece of the brief.**

Agora currently exposes itself to agents through `agora mcp` (stack + catalog tools). The brief's
§8 server is different: discovery filtered through *policy*, so an agent only ever sees artifacts
it is permitted to install.

- `search_tools` — capability search, results filtered through Cedar's `Serve` action
- `get_evidence` — the `agora trust` rows, as structured data
- `check_policy` — dry-run a decision without acting
- `request_install` — writes an *intent* and prints `agora approve <id>`. **Never mutates the
  stack.** This is the load-bearing constraint: an agent that could install its own tools is the
  attack this product exists to prevent.

The view model from C5 (`src/cli/trust-view.ts`) is already the right shape for `get_evidence` —
including its `unknown` states, which an agent needs even more than a human does.

**Skip the embeddings.** The brief specifies `@xenova/transformers` + `sqlite-vec` for semantic
search. That is a large model download on first run for a product with no users. The existing
BM25 index (`src/search/catalog-index.ts`) is good enough to prove the shape; revisit only if
someone complains about recall.

---

## 3. Make the evidence exportable — the spec is the marketing

**~3 days. High leverage for a product nobody has heard of.**

The brief's S8 says "the evidence-format spec IS the marketing", and it is right. Agora's claim is
*evidence, not scores*. The way to make that credible is to let people inspect and carry the
evidence:

- `agora export --attestations` — a DSSE bundle for one artifact or the whole stack
- Publish the generated `schemas/` (39 JSON Schema files already exist and are CI-guarded)
- One page documenting the attestation format

This is the cheapest thing on the list that would make a security-minded reader take the project
seriously, and it needs no infrastructure.

---

## 4. Reduce what has to be maintained

**A judgement call, deferred deliberately — revisit once real users exist.**

`src/` is 31,382 lines maintained by one person. Roughly 7,000 of those are the TUI and the chat
shell, which sit outside the v2 brief entirely. They are kept on purpose: built-in free inference
and the zero-mode-switch shell are a real onboarding argument, and C5 wired them to the trust
plane so they now show verdicts rather than catalog rows.

But that decision was made without evidence. **After 0.7.0 ships, look at whether anyone uses
them.** If the TUI sees no use, deleting it removes ~4,400 lines of surface that every future
refactor has to thread through. Do not decide this before there is data — that is exactly the
premature call this document is trying to avoid.

---

## 5. Smaller things worth doing, roughly in value order

- **`agora doctor` secrets scan** (brief §9) — flag plaintext API keys in host configs with
  `file:line` and a keychain/env remediation hint. Small, obviously useful, and fits the existing
  doctor output.
- **`agora observe` → richer divergence.** Only `undeclared-egress` is computed today. The
  `Divergence` model supports more kinds; filesystem and process divergence would need the
  observer to see more than MCP frames.
- **Windows verification.** The stack adapters and `opencode-exec.ts` have Windows handling that
  has never run on Windows. Either test it in CI or say plainly in the README that Windows is
  unverified.
- **A second inference provider** beyond opencode and Claude, if users ask. The `Provider`
  interface (`src/inference/types.ts`) makes this ~80 lines.
- **Release-lag visibility.** Nothing told anyone that `main` had drifted 33 commits ahead of
  npm with the entire product thesis among them; it was found by accident. A check is speculative
  infrastructure for a product with no release cadence — but if a second silent divergence
  happens, build it rather than trusting vigilance twice.

---

## Explicitly not doing

- **A hosted backend.** Non-negotiable in `AGENTS.md`, and the one dependency that would make
  Agora fail when someone else's server does. The Cloudflare Worker scaffold in `workers/api/`
  serves the revocation feed *only*, and even that can be a signed file in git.
- **The Docker sandbox `vet`.** Replaced by runtime observation after a pre-implementation review
  (see `V2_EXECUTION_PLAN.md` S6). The `ObservedProfile` model is unchanged, so a pre-install
  backend can be added later if a real need appears — but do not build it speculatively.
- **Canary tokens.** Dropped with the sandbox. They need a callback endpoint on a domain that
  does not exist, and the attribute `canary_triggered` remains only so a policy guarding on it
  stays valid.
- **Semantic search.** See §2.
- **Anything requiring recurring spend** until there is a reason. The founder is funding this
  personally; a $5/mo Worker and a $12/yr domain are real decisions, not rounding errors.

---

## How to work on this

Conventions that held up over 16 commits and are worth keeping:

- **Everything lands on `main`, pushed often.** CI green at every push.
- **Verify against the built binary, not the tests.** Three real bugs this session were found by
  running `node dist/cli.js` and reading the output — a provenance row that said "no attestation"
  for a signed package, a test suite making live network calls, and two commands advertising
  things that no longer existed.
- **After deleting a module, re-run the dead-export scan.** Three times in one session, removing
  a module stranded its helper one commit later.
- **Absence of evidence is never a positive finding.** This is the product's whole differentiator
  and the easiest thing to erode by accident. `src/cli/trust-view.ts` documents the rule;
  `test/cli/trust-view.test.ts` enforces one case per plane.
