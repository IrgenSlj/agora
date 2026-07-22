import type { z } from 'zod';
import { ArtifactKind, ArtifactRef, ArtifactSource, Publisher, SourceAdapter } from './artifact.js';
import {
  DSSEEnvelope,
  InTotoStatement,
  PredicateType,
  ProvenanceVerification,
  SigningTier,
  StatementSubject
} from './attestation.js';
import { ArtifactLockEntry, Lockfile, PolicyDecision, PolicyVerdict } from './lockfile.js';
import {
  AuthModel,
  DeclaredCapabilities,
  DeclaredManifest,
  DeclaredTool,
  ManifestSource,
  Transport
} from './manifest.js';
import {
  Divergence,
  DivergenceKind,
  DivergenceSeverity,
  NetworkContact,
  ObservedBehavior,
  ObservedProfile,
  VetBackend,
  VetLevel
} from './observed.js';
import {
  CedarAction,
  CedarArtifact,
  CedarArtifactAttributes,
  CedarPolicyDecision,
  CedarPolicyRequest,
  CedarProject,
  CedarPublisher
} from './policy.js';
import { RevocationEntry, RevocationFeed, RevocationSeverity } from './revocation.js';

export interface ModelSchemaEntry {
  name: string;
  schema: z.ZodType;
}

export const MODEL_SCHEMAS: ModelSchemaEntry[] = [
  { name: 'artifact-ref', schema: ArtifactRef },
  { name: 'artifact-kind', schema: ArtifactKind },
  { name: 'publisher', schema: Publisher },
  { name: 'artifact-source', schema: ArtifactSource },
  { name: 'source-adapter', schema: SourceAdapter },

  { name: 'declared-manifest', schema: DeclaredManifest },
  { name: 'declared-tool', schema: DeclaredTool },
  { name: 'declared-capabilities', schema: DeclaredCapabilities },
  { name: 'transport', schema: Transport },
  { name: 'auth-model', schema: AuthModel },
  { name: 'manifest-source', schema: ManifestSource },

  { name: 'observed-profile', schema: ObservedProfile },
  { name: 'observed-behavior', schema: ObservedBehavior },
  { name: 'network-contact', schema: NetworkContact },
  { name: 'divergence', schema: Divergence },
  { name: 'divergence-kind', schema: DivergenceKind },
  { name: 'divergence-severity', schema: DivergenceSeverity },
  { name: 'vet-level', schema: VetLevel },
  { name: 'vet-backend', schema: VetBackend },

  { name: 'in-toto-statement', schema: InTotoStatement },
  { name: 'dsse-envelope', schema: DSSEEnvelope },
  { name: 'statement-subject', schema: StatementSubject },
  { name: 'predicate-type', schema: PredicateType },
  { name: 'signing-tier', schema: SigningTier },
  { name: 'provenance-verification', schema: ProvenanceVerification },

  { name: 'lockfile', schema: Lockfile },
  { name: 'artifact-lock-entry', schema: ArtifactLockEntry },
  { name: 'policy-verdict', schema: PolicyVerdict },
  { name: 'policy-decision', schema: PolicyDecision },

  { name: 'revocation-feed', schema: RevocationFeed },
  { name: 'revocation-entry', schema: RevocationEntry },
  { name: 'revocation-severity', schema: RevocationSeverity },

  { name: 'cedar-project', schema: CedarProject },
  { name: 'cedar-publisher', schema: CedarPublisher },
  { name: 'cedar-artifact', schema: CedarArtifact },
  { name: 'cedar-artifact-attributes', schema: CedarArtifactAttributes },
  { name: 'cedar-action', schema: CedarAction },
  { name: 'cedar-policy-request', schema: CedarPolicyRequest },
  { name: 'cedar-policy-decision', schema: CedarPolicyDecision }
];
