// Exportable evidence — the in-toto/DSSE bundle behind `agora export --attestations`.
//
// The brief's S8 argues the evidence format *is* the marketing, and it is right
// for a reason that is not really about marketing: a trust plane nobody can
// audit is just another scoring service with better adjectives. Agora's claim is
// evidence, not scores. That claim is only checkable if the evidence leaves the
// tool in a form someone else's tooling can read.
//
// ── TWO RULES THIS FILE EXISTS TO ENFORCE ───────────────────────────────────
//
// 1. **Nothing is attested that was not established.** A bundle carries a
//    statement per plane that actually produced evidence, and every plane that
//    did not lands in `not_established` with the reason. An exporter that
//    quietly omitted the unknowns would turn "we never observed this server"
//    into "no adverse observations" the moment the file left the machine —
//    which is the same erosion `src/cli/trust-view.ts` guards in the UI, at a
//    point where nobody is watching.
//
// 2. **No digest is ever invented.** in-toto binds a statement to a content
//    hash, and a hash we made up would bind it to nothing while looking
//    authoritative. When the artifact is not pinned in `agora.lock` there is no
//    digest to attest over, so no statement is emitted for it at all — the gap
//    is reported instead.
//
// Signing: envelopes are emitted with `tier: 'none'` and an empty signature
// list. Agora has no attestation-signing identity, and the feed key is for
// revocations and must not be reused to make evidence look endorsed. An
// unsigned DSSE envelope is still a useful, well-specified container — it just
// attests to what Agora observed, not to who Agora is. Callers must say so.

import type { DSSEEnvelope, InTotoStatement, PredicateType } from '../model/attestation.js';
import { canonicalJson } from '../model/hash.js';
import type { Divergence } from '../model/observed.js';

/** A plane that produced no evidence, and why. Never silently dropped. */
export interface NotEstablished {
  plane: 'provenance' | 'scan' | 'policy' | 'revocation' | 'observed' | 'subject';
  reason: string;
}

export interface BundleSubject {
  /** purl of the artifact. */
  name: string;
  /** SHA-256 of the tarball, from `agora.lock`. Absent when not pinned. */
  sha256?: string;
}

export interface BundleEvidence {
  provenance?: {
    verified: boolean;
    reason?: string;
    sourceRepo?: string;
    rekorLogIndex?: number;
  } | null;
  scan?: {
    pass: number;
    warn: number;
    fail: number;
    checks: readonly { id: string; status: string; detail?: string }[];
  } | null;
  observation?: {
    sessions: number;
    toolCalls: number;
    networkSampled: boolean;
    hostsContacted: readonly string[];
    divergences: readonly Divergence[];
  } | null;
}

export interface EvidenceBundle {
  _type: 'https://agora-hub.dev/evidence-bundle/v1';
  generated_at: string;
  tool: { name: 'agora'; version: string };
  subject: BundleSubject;
  /** DSSE envelopes, one per plane that produced evidence. */
  attestations: DSSEEnvelope[];
  /** Planes that produced nothing. An empty array here is itself a claim. */
  not_established: NotEstablished[];
}

/** Wraps a statement in an unsigned DSSE envelope. */
function envelope(statement: InTotoStatement): DSSEEnvelope {
  return {
    payloadType: 'application/vnd.in-toto+json',
    // Canonicalised before encoding so the same evidence always produces the
    // same bytes — two exports of an unchanged artifact should be diffable.
    payload: Buffer.from(canonicalJson(statement), 'utf8').toString('base64'),
    signatures: [],
    tier: 'none'
  };
}

function statement(
  subject: BundleSubject & { sha256: string },
  predicateType: PredicateType,
  predicate: Record<string, unknown>
): InTotoStatement {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: subject.name, digest: { sha256: subject.sha256 } }],
    predicateType,
    predicate
  };
}

export interface BuildBundleInput {
  subject: BundleSubject;
  evidence: BundleEvidence;
  version: string;
  now?: Date;
}

/**
 * Builds the bundle. Pure — no IO, no clock unless injected — so the honesty
 * rules above are testable without a filesystem or a terminal.
 */
export function buildEvidenceBundle(input: BuildBundleInput): EvidenceBundle {
  const { subject, evidence } = input;
  const attestations: DSSEEnvelope[] = [];
  const notEstablished: NotEstablished[] = [];

  const digest = subject.sha256;
  if (!digest) {
    // Rule 2. Without a content hash there is nothing to bind a statement to,
    // so every plane's evidence — however good — cannot be attested here.
    notEstablished.push({
      plane: 'subject',
      reason:
        'no content digest — the artifact is not pinned in agora.lock, so there is ' +
        'nothing to bind an attestation to. Run `agora acquire` or `agora lock` first.'
    });
  }

  const pinned = digest ? { ...subject, sha256: digest } : null;

  /**
   * Records one plane. Every plane resolves to exactly one of: an attestation,
   * or a stated reason there is none.
   *
   * This helper exists because the hand-written version of it had a hole. Each
   * plane read `else if (pinned)`, so an artifact with no digest but real
   * provenance produced neither a statement nor a `not_established` entry — the
   * evidence simply vanished from the bundle, and a reader would see a shorter
   * list rather than a gap. That is precisely the erosion this file is written
   * to prevent, and it survived until the built binary was run against a
   * catalog item that was not locked.
   */
  function plane(
    name: NotEstablished['plane'],
    held: unknown,
    absent: string,
    predicateType: PredicateType,
    predicate: () => Record<string, unknown>
  ): void {
    if (held === undefined || held === null) {
      notEstablished.push({ plane: name, reason: absent });
      return;
    }
    if (!pinned) {
      notEstablished.push({
        plane: name,
        reason: `evidence held but not attestable — ${name} was established, but there is no content digest to bind it to`
      });
      return;
    }
    attestations.push(envelope(statement(pinned, predicateType, predicate())));
  }

  plane(
    'provenance',
    evidence.provenance,
    evidence.provenance === null
      ? 'no published attestation — which is not a failed signature'
      : 'not checked',
    'https://agora-hub.dev/attestations/provenance-verification/v1',
    () => ({
      verified: evidence.provenance?.verified,
      reason: evidence.provenance?.reason,
      source_repo: evidence.provenance?.sourceRepo,
      rekor_log_index: evidence.provenance?.rekorLogIndex
    })
  );

  plane(
    'scan',
    evidence.scan,
    'not run',
    'https://agora-hub.dev/attestations/declared-manifest/v1',
    () => ({
      summary: {
        pass: evidence.scan?.pass,
        warn: evidence.scan?.warn,
        fail: evidence.scan?.fail
      },
      checks: evidence.scan?.checks
    })
  );

  plane(
    'observed',
    evidence.observation,
    'never run through `agora run` — no behaviour recorded, which is not good behaviour',
    'https://agora-hub.dev/attestations/observed-profile/v1',
    () => ({
      sessions: evidence.observation?.sessions,
      tool_calls: evidence.observation?.toolCalls,
      network_sampled: evidence.observation?.networkSampled,
      hosts_contacted: evidence.observation?.hostsContacted,
      divergences: evidence.observation?.divergences
    })
  );

  // Policy and revocation are gates evaluated by `agora acquire`, not standing
  // evidence about an artifact. Claiming a verdict this export did not compute
  // is the failure mode this whole file is arranged against.
  notEstablished.push({
    plane: 'policy',
    reason: 'not evaluated by export — run `agora acquire` to evaluate policy'
  });
  notEstablished.push({
    plane: 'revocation',
    reason: 'not evaluated by export — run `agora acquire` to check the revocation feed'
  });

  return {
    _type: 'https://agora-hub.dev/evidence-bundle/v1',
    generated_at: (input.now ?? new Date()).toISOString(),
    tool: { name: 'agora', version: input.version },
    subject,
    attestations,
    not_established: notEstablished
  };
}

/** Decodes an envelope's payload back to a statement — for tests and consumers. */
export function decodeStatement(env: DSSEEnvelope): InTotoStatement {
  return JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8')) as InTotoStatement;
}
