import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Import all schemas
import {
  ArtifactRef,
  ArtifactKind,
  Publisher,
  ArtifactSource,
  SourceAdapter
} from '../src/model/artifact.js';
import {
  DeclaredManifest,
  DeclaredTool,
  DeclaredCapabilities,
  Transport,
  AuthModel,
  ManifestSource
} from '../src/model/manifest.js';
import {
  ObservedProfile,
  ObservedBehavior,
  NetworkContact,
  Divergence,
  DivergenceKind,
  DivergenceSeverity,
  VetLevel,
  VetBackend
} from '../src/model/observed.js';
import {
  InTotoStatement,
  DSSEEnvelope,
  StatementSubject,
  PredicateType,
  SigningTier,
  ProvenanceVerification
} from '../src/model/attestation.js';
import {
  Lockfile,
  ArtifactLockEntry,
  PolicyVerdict,
  PolicyDecision
} from '../src/model/lockfile.js';
import { RevocationFeed, RevocationEntry, RevocationSeverity } from '../src/model/revocation.js';
import {
  CedarProject,
  CedarPublisher,
  CedarArtifact,
  CedarArtifactAttributes,
  CedarAction,
  CedarPolicyRequest,
  CedarPolicyDecision
} from '../src/model/policy.js';

const SCHEMAS_DIR = join(import.meta.dirname, '..', 'schemas');
mkdirSync(SCHEMAS_DIR, { recursive: true });

function exportSchema(name: string, schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema);
  const path = join(SCHEMAS_DIR, `${name}.v1.json`);
  writeFileSync(path, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`Generated ${path}`);
}

// Artifact schemas
exportSchema('artifact-ref', ArtifactRef);
exportSchema('artifact-kind', ArtifactKind);
exportSchema('publisher', Publisher);
exportSchema('artifact-source', ArtifactSource);
exportSchema('source-adapter', SourceAdapter);

// Manifest schemas
exportSchema('declared-manifest', DeclaredManifest);
exportSchema('declared-tool', DeclaredTool);
exportSchema('declared-capabilities', DeclaredCapabilities);
exportSchema('transport', Transport);
exportSchema('auth-model', AuthModel);
exportSchema('manifest-source', ManifestSource);

// Observed schemas
exportSchema('observed-profile', ObservedProfile);
exportSchema('observed-behavior', ObservedBehavior);
exportSchema('network-contact', NetworkContact);
exportSchema('divergence', Divergence);
exportSchema('divergence-kind', DivergenceKind);
exportSchema('divergence-severity', DivergenceSeverity);
exportSchema('vet-level', VetLevel);
exportSchema('vet-backend', VetBackend);

// Attestation schemas
exportSchema('in-toto-statement', InTotoStatement);
exportSchema('dsse-envelope', DSSEEnvelope);
exportSchema('statement-subject', StatementSubject);
exportSchema('predicate-type', PredicateType);
exportSchema('signing-tier', SigningTier);
exportSchema('provenance-verification', ProvenanceVerification);

// Lockfile schemas
exportSchema('lockfile', Lockfile);
exportSchema('artifact-lock-entry', ArtifactLockEntry);
exportSchema('policy-verdict', PolicyVerdict);
exportSchema('policy-decision', PolicyDecision);

// Revocation schemas
exportSchema('revocation-feed', RevocationFeed);
exportSchema('revocation-entry', RevocationEntry);
exportSchema('revocation-severity', RevocationSeverity);

// Policy schemas
exportSchema('cedar-project', CedarProject);
exportSchema('cedar-publisher', CedarPublisher);
exportSchema('cedar-artifact', CedarArtifact);
exportSchema('cedar-artifact-attributes', CedarArtifactAttributes);
exportSchema('cedar-action', CedarAction);
exportSchema('cedar-policy-request', CedarPolicyRequest);
exportSchema('cedar-policy-decision', CedarPolicyDecision);

console.log('All schemas generated successfully.');
