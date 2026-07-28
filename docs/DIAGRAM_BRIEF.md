# Diagram brief — Agora README architecture set

A commission brief for producing the architectural diagrams that carry the GitHub front page.
Everything a designer needs to work without reading the codebase is in this file.

**Deliverable:** five SVG diagrams, `docs/assets/diagram-*.svg`, embedded in `README.md`.
**Status of facts here:** verified against the codebase on 2026-07-25 (v0.6.1+). The honesty rules in
§5 are product policy, not art direction — they are the one thing that must not be softened.

---

## 1. What Agora is, in one paragraph

You install MCP servers and Agent Skills into your coding agents — Claude Code, Cursor, Windsurf,
OpenCode. Each one is code from a stranger that your agent runs with your credentials. Registries
tell you *what exists*. Nothing tells you whether a specific artifact should run in a specific
project, and nothing can revoke it tomorrow when it turns malicious. Agora is the customs office
between the registries and your machine.

The product noun that matters is **evidence**. Agora never emits a numeric "trust score" — every
verdict is a policy decision evaluated over verifiable, inspectable attestations. If a diagram
implies a score, a rating, a percentage, or a grade, it is wrong.

## 2. Audience and reading order

The viewer is a **working developer on the GitHub page for 30 seconds**, deciding whether this is
worth an install. They are not a contributor, and they will not read a legend before looking at the
picture.

Consequences:
- Diagrams must survive being skimmed at thumbnail size. One idea each.
- Label with product nouns (`agora.toml`, `purl`, `attestation`, `drift`), never with file paths or
  module names. `src/federation/adapters/` means nothing to this viewer.
- No diagram may require another diagram to make sense.

## 3. Brand system

Taken from the live terminal renderer (`src/ui.ts`) — the diagrams must look like the same product
as the CLI a user sees three minutes later.

**Palette — "marble & terracotta."** A purely warm Mediterranean sweep; neither endpoint touches
pure black or white.

| Token | Hex | Role |
|---|---|---|
| Cream | `#DCC49E` | gradient start; light fills, top-lit edges |
| Terracotta | `#C66A4A` | gradient middle; primary accent, active flow |
| Brick | `#944038` | gradient end; emphasis, the FAIL/deny state |
| Amber | `#D4A85A` | identifiers, keys, artifact names |
| Stone dim | `#6B6253` | inactive strokes, secondary rules |
| Warm dim | `#7A5A48` | trailing/receding elements |

Use the cream → terracotta → brick sweep for *directional flow* (left-to-right or top-to-bottom
through a pipeline). Do not use it decoratively on unrelated elements.

**Metaphor.** The wordmark is carved relief — top-lit stone, letterforms with a highlight above and
a shadow below. Agora is a Greek marketplace: civic, stone, permanent, a place with *gates*. Lean
into architectural language — thresholds, gates, customs, ledgers, seals. Avoid: shields, padlocks,
checkmark badges, "AI" glows, neon, circuitry, gradients into purple/blue.

**Typography.** One humanist sans for labels. Monospace only for literal terminal strings and
identifiers (`agora.toml`, `pkg:npm/...`). Never set body labels in monospace "because developer."

## 4. Hard technical constraints

- **SVG, hand-authorable, no external references.** No `<image>` links, no web fonts, no scripts.
  GitHub sanitizes README SVGs aggressively; assume CSS-in-SVG and `@media` queries are stripped.
- **Therefore: no `prefers-color-scheme`.** GitHub renders README images against both light and dark
  backgrounds and you cannot detect which. Two options, pick per diagram and state which you used:
  1. **Preferred** — one artwork that works on both, achieved by keeping every element on an opaque
     filled panel with its own background, so the page background never touches the artwork.
  2. Two files plus `<picture>` + `<source media="(prefers-color-scheme: dark)">` in the README
     markdown (this *is* supported, unlike CSS inside the SVG).
- **Text must be real `<text>`, not paths.** It is the only way the diagram stays searchable,
  translatable, and legible when a reader zooms.
- **Width:** design on a 1000–1200px canvas, `viewBox` set, no fixed `width`/`height` attributes, so
  GitHub scales it into its ~830px content column. Verify legibility at 830px.
- **Contrast:** every label ≥ 4.5:1 against its own fill. Brick `#944038` on cream `#DCC49E` passes;
  terracotta on cream does not — check before shipping.
- **Never encode meaning in colour alone.** Every state distinction needs a second cue (shape,
  weight, a word). Assume a red-green colourblind reader; note our palette is already all-warm,
  which makes shape/label redundancy mandatory rather than optional.
- **File size:** under 100KB each; these load on every page view.

## 5. The honesty rules — non-negotiable

Agora's core promise is that it never overstates what it knows. The diagrams are marketing surface,
which makes them the easiest place to break that promise. Three rules:

**5.1 — Live and unbuilt must be visually distinct, and the distinction must be legible without the
legend.** Roughly half the architecture is designed but not implemented. A diagram that renders the
whole thing in confident solid boxes is a lie told in vector form. Use solid fill + full opacity for
shipped, and a clearly unfinished treatment for planned (dashed 2px stroke, no fill, 60% opacity,
plus the literal word "planned"). Do not use a lighter tint alone — that reads as "secondary," not
"does not exist."

**5.2 — "Passed the gate" never means "safe."** Wherever a passing verdict appears, it must read as
*no known red flags*. Never render a green check, a shield, or the word "safe"/"secure"/"verified
safe". The product ships this distinction in its own output and the diagrams may not undo it.

**5.3 — No invented numbers.** No "20,000+ servers scanned", no percentages, no benchmark figures,
no fake sparklines. If a count appears it must be one of the verified figures in §6.

## 6. Verified facts to draw from

Current as of v0.6.1+. **Do not draw anything not on this list as if it works.**

**Shipped and working:**
- Cross-host stack management: one `agora.toml` profile → OpenCode, Claude Code, Cursor, Windsurf.
- `plan` / `apply` (Terraform-style diff then reconcile), `sync --from <git-url>`, `doctor`, `freeze`.
- Surgical atomic config writes — every unrelated key in a host's config is preserved.
- Multi-source search, deduped by purl, with honest per-source status.
- A heuristic gate on `acquire`: injection-pattern, permission-diff, and schema-drift checks.
- Schema/description hashing and drift detection; description-poisoning heuristics.
- `agora.lock` as committed machine truth; quarantine for drifted servers.

**Also built (this list was out of date until 2026-07-28 — check ROADMAP.md before drawing):**
- **Live Sigstore provenance**: Fulcio chain, CT log and Rekor inclusion, with the signing
  certificate's identity bound to the repository the attestation claims.
- **Cedar policy engine** evaluated over that evidence, with a shipped baseline.
- **Runtime observation**: `agora run -- <server>` supervises a server during real use and
  records what it did. This *replaced* the Docker sandbox — do not draw a sandbox.
- **Revocation client**: ed25519-signed feed with anti-rollback. Draw it, but note that no
  public key is pinned yet, so no revocations currently apply.

**Partial — draw as partial:**
- Revocation *publishing* (the feed endpoint and signing key) does not exist.

**Not built — draw as planned, or omit:**
- Agent-facing `agora serve` discovery (S7).
- Sandboxed pre-install `vet` and canary-token exfiltration detection. **Both were dropped**
  when S6 became runtime observation — do not draw either as forthcoming.

**Source counts (exact).** Eight adapters exist. **Four query by default:** the official MCP Registry
(canonical), Glama, GitHub, and skills-github — plus a bundled local catalog. PulseMCP is disabled
(no self-serve API). Smithery and Hugging Face are non-canonical, opt-in via
`AGORA_ENABLE_NONCANONICAL_SOURCES`. Glama's endpoint is currently returning 504s upstream. A source
that cannot answer reports `unreachable` **with a reason** and falls back to its cache; it never
reports an empty result as success. That degradation behaviour is a feature and is worth drawing.

**Host count:** four. OpenCode is one integration among four, never the identity.

---

## 7. The five diagrams

### D1 — The four planes *(hero; the one that matters most)*

**Job:** in one glance, "what is this thing." This is the diagram embedded highest in the README.

**Content.** Four horizontal bands, stacked, with a single directional flow top → bottom carrying the
cream → terracotta → brick gradient:

1. **FEDERATE** — many upstream registries converge into one deduped catalog. Show convergence
   visually: several inputs, one output. Label the dedupe key as `purl`.
2. **VERIFY** — the catalog artifact acquires evidence: provenance, schema hash, drift, observed
   behaviour. Evidence items should look like *attachments to the artifact*, not like a score being
   computed. Mark Sigstore verification and `vet` per rule 5.1.
3. **GATE** — the threshold. Policy is evaluated over the evidence from the band above; the outcome
   is pass-through or refusal. This band is the product's centre of gravity; give it the most weight.
   Mark Cedar and revocation as planned.
4. **MANAGE** — what survives the gate is written into the four hosts and recorded in `agora.lock`.

**Must convey:** each plane consumes the one above it. Evidence flows *into* policy — that is the
whole thesis, and it is the thing a generic four-box diagram would lose.

**Must not:** render the four planes as four independent parallel features. Do not put a score
anywhere. Do not show the gate as a padlock.

### D2 — The acquire path

**Job:** show the customs office in motion — what actually happens between typing a command and a
config file changing.

**Content.** A left-to-right pipeline for `agora acquire <name>`:
`resolve → collect evidence → evaluate policy → write config → record in lock`
with an explicit **refusal branch** leaving the gate stage, labelled with what a refusal does:
blocks the write, exits non-zero.

**Must convey:** the refusal path is a first-class outcome, not an error state — draw it with the
same weight as the success path, in brick. The write happens *only* after the gate.

**Must not:** imply the gate executes or sandboxes the server today. It does not — `vet` is
unbuilt. Mark the sandbox stage as planned or leave it out.

Annotate the pass verdict as **"no known red flags"** (rule 5.2).

### D3 — One search, every registry

**Job:** "a customs office over registries, not a competing catalog."

**Content.** One query fanning out to the sources in §6, results merging back through a dedupe step
keyed on `purl`, into a single ranked result list. Show the per-source status states honestly:
`ok · n` / `unreachable — reason` / `offline — disabled`, and show the cache fallback path that a
failing source drops to.

**Must convey:** Agora's effective catalog is everyone else's combined; and a degraded source
degrades visibly rather than silently. Differentiate default-on sources from opt-in ones.

**Must not:** show eight equal live sources. That is the specific overstatement this diagram exists
to avoid.

### D4 — One profile, every host

**Job:** the daily-driver value, and the most complete part of the product.

**Content.** `agora.toml` (intent, committed, no credentials) and `agora.lock` (truth, hashed) on one
side; the four host config files on the other; `plan` and `apply` as the two directions between
them. Show `doctor` reading across all four and reporting drift.

**Must convey:** writes are *surgical* — the host's unrelated existing keys survive untouched. This
is the detail that earns trust from anyone who has had a tool clobber their config. Consider showing
a host config with foreign keys visibly preserved around the touched one.

**Must not:** suggest Agora owns or replaces the host's config file.

### D5 — Build status map

**Job:** the honesty diagram. Rule 5.1, made explicit, so the other four can be read at face value.

**Content.** The nine phases (S0 hygiene · S1 data model · S2 multi-source · S3 provenance · S4
revocation · S5 policy · S6 vet · S7 serve · S8 launch) with true states: S0–S2 complete, S3 partial,
S4–S8 not started. Show the dependency that S6 must follow S5.

**Must convey:** this is a mid-build project with a specific, ordered plan — not vapour, and not
finished. Honesty here is a differentiator, not an apology; give it a confident treatment.

**Must not:** invent dates or timelines.

---

## 8. Placement in README

| Diagram | Position |
|---|---|
| D1 four planes | directly under the hero banner, above "Why this exists" |
| D3 one search | inside the Federate bullet |
| D2 acquire path | inside the Gate bullet |
| D4 one profile | inside the Manage bullet |
| D5 build status | replacing or beside the current "Status — honestly" table |

## 9. Definition of done

- [ ] Legible at 830px wide and recognisable at thumbnail size.
- [ ] Readable on both GitHub light and dark (state which technique from §4 was used).
- [ ] Every label ≥ 4.5:1 contrast on its own fill.
- [ ] Every state cue is shape/label-redundant, not colour-only.
- [ ] Live vs. planned distinguishable without reading a legend (rule 5.1).
- [ ] No score, rating, percentage, shield, padlock, or the word "safe" anywhere (rules 5.2, 5.3).
- [ ] Every claim traceable to §6.
- [ ] Real `<text>` nodes; no external references; under 100KB.
