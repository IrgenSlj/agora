// Translation layer: Agora's evidence → the Cedar entity model (brief §7.1).
//
// One rule governs this file: **an attribute is present only when Agora
// actually observed the fact it asserts.** Everything else is omitted.
//
// That is not fastidiousness, it is the difference between a policy plane and
// a liability. Cedar hands a decision back with the authority of a formal
// engine; if the attributes feeding it are guesses, the engine laundres a
// guess into a verdict. Two concrete traps this avoids:
//
//   - Only 7 of the 67 bundled catalog packages declare any permissions at all.
//     Emitting `exec: false` for the other 60 would assert "this server does
//     not execute anything" when the truth is "nobody said." A policy reading
//     `forbid when { resource.exec }` would then pass almost everything, and
//     look like it was working.
//
//   - The permission model is `{ fs, net, exec }` — there is no read/write
//     split anywhere in the data. Synthesising `fs_read`/`fs_write` from one
//     signal would let a team write `forbid when { resource.fs_write }` and
//     silently block every read-only filesystem server too.
//
// Policies therefore guard with `has` (`resource has exec && resource.exec`),
// and `permissions_declared` exists so a policy can require evidence rather
// than merely react to it. See defaults/baseline.cedar.

import type { ScanResult } from '../scan.js';

export type AttestationTier = 'sigstore' | 'local' | 'none';
export type Divergence = 'none' | 'info' | 'warn' | 'critical';

/**
 * Mirrors `entity Artifact` in defaults/agora.cedarschema. Every field is
 * optional in exactly the cases where the evidence may be missing — the type
 * is the documentation of what Agora can and cannot know.
 */
export interface ArtifactAttributes {
  kind: string;
  publisher_namespace: string;

  /** Whether a permission manifest was declared at all. Always known. */
  permissions_declared: boolean;

  /** Present only when a permission manifest was declared. */
  fs?: boolean;
  exec?: boolean;
  net_hosts?: string[];

  /** Present only when the provenance plane produced a verdict. */
  provenance_verified?: boolean;
  attestation_tier?: AttestationTier;

  /** Present only when the revocation feed was actually consulted. */
  revoked?: boolean;

  /** Present only once a sandboxed vet has run (S6). Absent until then. */
  canary_triggered?: boolean;

  /** Present only when a scan was performed. */
  divergence_max?: Divergence;
}

export interface EntityJson {
  uid: { type: string; id: string };
  attrs: Record<string, unknown>;
  parents: Array<{ type: string; id: string }>;
}

export interface BuildEntitiesInput {
  /** Stable identity of the thing being decided about — a purl where we have one. */
  purl: string;
  /** The project making the request; policies can scope rules per project. */
  projectId?: string;
  scan?: ScanResult;
  /** Provenance verdict, when the provenance plane produced one. */
  provenance?: { verified: boolean; reason?: string };
  /**
   * Revocation verdict. `undefined` means the feed was never consulted (no
   * cache yet), which is materially different from "consulted, not revoked".
   */
  revoked?: boolean;
  /** Observed canary result. Absent until `agora vet` exists (S6). */
  canaryTriggered?: boolean;
  kind?: string;
  publisherNamespace?: string;
  /**
   * The declared permission manifest. `undefined` means none was declared —
   * which is the common case, and is recorded as such rather than as "no
   * permissions needed".
   */
  permissions?: { fs?: string[]; net?: string[]; exec?: string[] };
}

export const PROJECT_ENTITY_TYPE = 'Project';
export const ARTIFACT_ENTITY_TYPE = 'Artifact';

/** Worst scan status becomes `divergence_max`. Undefined when no scan ran. */
export function divergenceFromScan(scan: ScanResult | undefined): Divergence | undefined {
  if (!scan) return undefined;
  if (scan.summary.fail > 0) return 'critical';
  if (scan.summary.warn > 0) return 'warn';
  return 'none';
}

/** True when the manifest declares at least one capability of any kind. */
function hasDeclaredPermissions(p: BuildEntitiesInput['permissions']): boolean {
  return Boolean(p && (p.fs?.length || p.net?.length || p.exec?.length));
}

export function artifactAttributes(input: BuildEntitiesInput): ArtifactAttributes {
  const attrs: ArtifactAttributes = {
    kind: input.kind ?? 'mcp-server',
    publisher_namespace: input.publisherNamespace ?? '',
    permissions_declared: hasDeclaredPermissions(input.permissions)
  };

  // Permission attributes appear only alongside a real manifest. Note there is
  // deliberately no fs_read/fs_write split: the data does not carry one, so
  // neither does the entity.
  if (attrs.permissions_declared && input.permissions) {
    attrs.fs = Boolean(input.permissions.fs?.length);
    attrs.exec = Boolean(input.permissions.exec?.length);
    attrs.net_hosts = input.permissions.net ?? [];
  }

  if (input.provenance) {
    attrs.provenance_verified = input.provenance.verified;
    // Only a verified, identity-bound signature earns the sigstore tier.
    // "Checked and failed" and "could not check" both land on none.
    attrs.attestation_tier = input.provenance.verified ? 'sigstore' : 'none';
  }

  if (input.revoked !== undefined) attrs.revoked = input.revoked;
  if (input.canaryTriggered !== undefined) attrs.canary_triggered = input.canaryTriggered;

  const divergence = divergenceFromScan(input.scan);
  if (divergence !== undefined) attrs.divergence_max = divergence;

  return attrs;
}

/** The entity set Cedar evaluates against. */
export function buildEntities(input: BuildEntitiesInput): EntityJson[] {
  return [
    {
      uid: { type: PROJECT_ENTITY_TYPE, id: input.projectId ?? 'default' },
      attrs: {},
      parents: []
    },
    {
      uid: { type: ARTIFACT_ENTITY_TYPE, id: input.purl },
      attrs: artifactAttributes(input) as unknown as Record<string, unknown>,
      parents: []
    }
  ];
}
