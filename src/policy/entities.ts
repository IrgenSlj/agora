// Translation layer: Agora's evidence → the Cedar entity model (brief §7.1).
//
// This file is the whole reason the policy plane can be honest. Cedar decides
// over *attributes*, and every attribute here has to come from something Agora
// actually observed. Where evidence is missing the attribute records the
// absence rather than a convenient default — `provenance_verified: false`
// because we could not check is materially different from `false` because a
// check failed, and `attestation_tier: "none"` says which one it was.
//
// Anything invented here would be a lie a policy then acts on with the full
// confidence of a formal engine, which is worse than no policy at all.

import type { ScanResult } from '../scan.js';

/** Mirrors `entity Artifact` in defaults/agora.cedarschema. */
export interface ArtifactAttributes {
  kind: string;
  publisher_namespace: string;
  provenance_verified: boolean;
  attestation_tier: 'sigstore' | 'local' | 'none';
  revoked: boolean;
  canary_triggered: boolean;
  fs_read: boolean;
  fs_write: boolean;
  exec: boolean;
  net_hosts: string[];
  divergence_max: 'none' | 'info' | 'warn' | 'critical';
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
  /** Verified provenance evidence, when the provenance plane produced any. */
  provenance?: { verified: boolean; reason?: string };
  /** Set when the revocation feed matched this artifact. */
  revoked?: boolean;
  /** Set once `vet` exists (S6); until then it is absent, never assumed false-because-safe. */
  canaryTriggered?: boolean;
  kind?: string;
  publisherNamespace?: string;
  permissions?: { fs?: string[]; net?: string[]; exec?: string[] };
}

export const PROJECT_ENTITY_TYPE = 'Project';
export const ARTIFACT_ENTITY_TYPE = 'Artifact';

/**
 * Worst scan status becomes `divergence_max`.
 *
 * A scan we never ran maps to "none" only in the sense of "no divergence
 * observed" — callers that care about the difference should check whether a
 * scan was supplied at all rather than reading it off this field.
 */
export function divergenceFromScan(
  scan: ScanResult | undefined
): ArtifactAttributes['divergence_max'] {
  if (!scan) return 'none';
  if (scan.summary.fail > 0) return 'critical';
  if (scan.summary.warn > 0) return 'warn';
  return 'none';
}

export function artifactAttributes(input: BuildEntitiesInput): ArtifactAttributes {
  const permissions = input.permissions ?? {};
  return {
    kind: input.kind ?? 'mcp-server',
    publisher_namespace: input.publisherNamespace ?? '',
    provenance_verified: input.provenance?.verified ?? false,
    // Only a verified signature earns the sigstore tier. "We did not check" and
    // "there was nothing to check" both land on none, which is the truth.
    attestation_tier: input.provenance?.verified ? 'sigstore' : 'none',
    revoked: input.revoked ?? false,
    canary_triggered: input.canaryTriggered ?? false,
    fs_read: Boolean(permissions.fs?.length),
    fs_write: Boolean(permissions.fs?.length),
    exec: Boolean(permissions.exec?.length),
    net_hosts: permissions.net ?? [],
    divergence_max: divergenceFromScan(input.scan)
  };
}

/** The entity set Cedar evaluates against. */
export function buildEntities(input: BuildEntitiesInput): EntityJson[] {
  const attrs = artifactAttributes(input);
  return [
    {
      uid: { type: PROJECT_ENTITY_TYPE, id: input.projectId ?? 'default' },
      attrs: {},
      parents: []
    },
    {
      uid: { type: ARTIFACT_ENTITY_TYPE, id: input.purl },
      attrs: attrs as unknown as Record<string, unknown>,
      parents: []
    }
  ];
}
