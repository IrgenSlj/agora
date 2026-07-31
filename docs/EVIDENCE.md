# The evidence format

Agora's claim is **evidence, not scores**. A number between 0 and 100 is an opinion wearing a
uniform: you cannot check it, you cannot disagree with it in detail, and you cannot carry it to
another tool. This document specifies what Agora emits instead, so that you can.

```
agora export --attestations mcp-filesystem > evidence.json
```

Everything below is generated from `src/model/`, and the JSON Schemas ship in the npm package
under `schemas/` — 39 of them, regenerated and diffed on every CI run, so a schema that drifts
from the code fails the build rather than quietly describing an older shape.

---

## The bundle

```json
{
  "_type": "https://agora-hub.dev/evidence-bundle/v1",
  "generated_at": "2026-07-31T12:00:04.947Z",
  "tool": { "name": "agora", "version": "0.7.0" },
  "subject": { "name": "pkg:npm/%40modelcontextprotocol/server-filesystem" },
  "attestations": [ /* DSSE envelopes */ ],
  "not_established": [ /* what is not known, and why */ ]
}
```

Two fields carry the weight.

**`attestations`** — a [DSSE](https://github.com/secure-systems-lab/dsse) envelope per plane that
produced evidence, each wrapping an [in-toto Statement v1](https://in-toto.io/Statement/v1).

**`not_established`** — every plane that produced nothing, with the reason. This is the half no
other tool in this ecosystem ships, and it is the more important one.

## Why `not_established` exists

The failure mode this format is designed against is not a wrong verdict. It is a *missing* one
read as a good one.

- No published attestation is **not** a failed signature.
- A policy allow reached with rules switched off is **not** a permit.
- An uncached revocation feed is **not** "not revoked".
- A server never run has **not** been shown to behave.

An exporter that emitted only positive statements would collapse each of those into silence, and
silence reads as approval — especially once the file has left the machine that knows better. So
every plane resolves to exactly one of: an attestation, or a stated reason there is none. Never
both, never neither. `test/evidence-bundle.test.ts` pins that for every combination of inputs.

## Predicate types

| Predicate | What it records |
|---|---|
| `https://agora-hub.dev/attestations/provenance-verification/v1` | Sigstore result: verified, source repo, reason, Rekor index when known |
| `https://agora-hub.dev/attestations/declared-manifest/v1` | What the scan gate saw — per-check status and the pass/warn/fail summary |
| `https://agora-hub.dev/attestations/observed-profile/v1` | What the server actually did under `agora run`: sessions, tool-call counts, sampled peers, divergences |

`policy` and `revocation` are **never** attested by export. They are gates `agora acquire`
evaluates against a stack at a moment in time, not standing facts about an artifact; exporting a
policy verdict this command never computed is the exact failure the format exists to prevent.
They appear in `not_established` with a pointer to `agora acquire`.

## Signing

Envelopes carry `"tier": "none"` and an empty `signatures` array.

Agora has no attestation-signing identity. The revocation feed's ed25519 key signs revocations
and is deliberately not reused here — a signature is a claim about *who*, and borrowing one to
make evidence look endorsed would be the same category of lie the rest of this format avoids.

So: **the bundle attests to what Agora observed, not to who Agora is.** The provenance statement
inside it may describe a Sigstore-verified signature by someone else; that verification is the
evidence, and it stands on its own transparency-log entry rather than on Agora's word. If you
need the bundle itself signed, sign it with your own key — the DSSE envelope is the right shape
for that already.

## Digests

in-toto binds a statement to a content hash. Agora takes that hash from `agora.lock`
(`integrity.tarball_sha256`), and **never computes a placeholder**. An artifact you have not
pinned yields no statements at all — only a `not_established` entry saying there is nothing to
bind to and how to fix it:

```json
{
  "plane": "subject",
  "reason": "no content digest — the artifact is not pinned in agora.lock, so there is nothing to bind an attestation to. Run `agora acquire` or `agora lock` first."
}
```

A made-up digest would bind the statement to nothing while looking authoritative, which is worse
than emitting no statement.

## Stability

Payloads are [JCS](https://www.rfc-editor.org/rfc/rfc8785)-canonicalised before base64 encoding,
so the same evidence always produces the same bytes and two exports of an unchanged artifact diff
cleanly. Use that: a bundle in version control turns "what changed about this dependency's
trustworthiness" into a code review.

## Reading a bundle without Agora

The envelope payload is base64 of a JSON in-toto Statement:

```bash
jq -r '.attestations[].payload' evidence.json | base64 -d | jq .
```

Nothing about consuming this format requires Agora, which is the point.
