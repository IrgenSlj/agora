import type { ProvenanceVerification } from '../model/attestation.js';
import { ProvenanceVerification as ProvenanceVerificationSchema } from '../model/attestation.js';
import { parsePurl } from '../model/purl.js';
import type { FetchLike } from '../retry.js';

export const PROVENANCE_PREDICATE_TYPE =
  'https://agora-hub.dev/attestations/provenance-verification/v1';

const SLSA_PROVENANCE_PREFIX = 'https://slsa.dev/provenance/';
const DEFAULT_NPM_REGISTRY = 'https://registry.npmjs.org';

export interface NpmProvenanceContext {
  purl: string;
  packageName: string;
  version: string;
  attestationUrl: string;
  statement: Record<string, unknown>;
  bundle: unknown;
}

export interface NpmProvenanceVerifierResult {
  verified: boolean;
  builder?: string;
  source_repo?: string;
  commit?: string;
  rekor_log_index?: number;
}

export type NpmProvenanceVerifier = (
  context: NpmProvenanceContext
) => Promise<NpmProvenanceVerifierResult>;

export interface VerifyNpmProvenanceOptions {
  fetcher?: FetchLike;
  registryBaseUrl?: string;
  verifier?: NpmProvenanceVerifier;
  offline?: boolean;
}

export interface NpmProvenanceEvidence {
  purl: string;
  version: string;
  predicateType: typeof PROVENANCE_PREDICATE_TYPE;
  predicate: ProvenanceVerification;
  attestationUrl: string;
}

interface NpmAttestation {
  predicateType?: string;
  bundle?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function normalizeRegistryBaseUrl(value: string | undefined): string {
  return (value || DEFAULT_NPM_REGISTRY).replace(/\/+$/, '');
}

function npmPackageFromPurl(purl: string): { packageName: string; version: string } | null {
  try {
    const parsed = parsePurl(purl);
    if (parsed.type !== 'npm' || !parsed.version) return null;
    const packageName = parsed.namespace ? `${parsed.namespace}/${parsed.name}` : parsed.name;
    return { packageName, version: parsed.version };
  } catch {
    return null;
  }
}

function encodeNpmName(name: string): string {
  return encodeURIComponent(name).replace(/^%40/i, '@');
}

export function npmAttestationsUrl(
  packageName: string,
  version: string,
  registryBaseUrl = DEFAULT_NPM_REGISTRY
): string {
  return `${normalizeRegistryBaseUrl(registryBaseUrl)}/-/npm/v1/attestations/${encodeNpmName(
    packageName
  )}@${encodeURIComponent(version)}`;
}

function noProvenance(
  purl: string,
  version: string,
  attestationUrl: string,
  reason: ProvenanceVerification['reason']
): NpmProvenanceEvidence {
  return {
    purl,
    version,
    predicateType: PROVENANCE_PREDICATE_TYPE,
    predicate: ProvenanceVerificationSchema.parse({ verified: false, reason }),
    attestationUrl
  };
}

function decodePayload(payload: unknown): Record<string, unknown> | null {
  const encoded = stringValue(payload);
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return asRecord(parsed) ?? null;
  } catch {
    return null;
  }
}

function statementForAttestation(attestation: NpmAttestation): Record<string, unknown> | null {
  const bundle = asRecord(attestation.bundle);
  const dsse = asRecord(bundle?.dsseEnvelope);
  if (!dsse) return null;
  return decodePayload(dsse.payload);
}

function findProvenanceAttestation(attestations: unknown[]): {
  attestation: NpmAttestation;
  statement: Record<string, unknown>;
} | null {
  for (const value of attestations) {
    const attestation = asRecord(value) as NpmAttestation | undefined;
    if (!attestation?.predicateType?.startsWith(SLSA_PROVENANCE_PREFIX)) continue;
    const statement = statementForAttestation(attestation);
    if (statement) return { attestation, statement };
  }
  return null;
}

function subjectMatches(statement: Record<string, unknown>, purl: string): boolean {
  return asArray(statement.subject).some((subject) => asRecord(subject)?.name === purl);
}

function normalizeGitRepository(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const withoutGitScheme = value.replace(/^git\+/, '');
  const match = withoutGitScheme.match(/^(https:\/\/github\.com\/[^/@]+\/[^/@]+?)(?:\.git)?(?:@.*)?$/i);
  if (match?.[1]) return match[1];
  return withoutGitScheme.replace(/\.git$/, '');
}

function firstResolvedGitCommit(predicate: Record<string, unknown>): string | undefined {
  const buildDefinition = asRecord(predicate.buildDefinition);
  const resolved = asArray(buildDefinition?.resolvedDependencies);
  for (const dependency of resolved) {
    const record = asRecord(dependency);
    const digest = asRecord(record?.digest);
    const gitCommit = stringValue(digest?.gitCommit);
    if (gitCommit) return gitCommit;
  }

  for (const material of asArray(predicate.materials)) {
    const record = asRecord(material);
    const digest = asRecord(record?.digest);
    const gitCommit = stringValue(digest?.gitCommit);
    if (gitCommit) return gitCommit;
  }
  return undefined;
}

function firstResolvedRepository(predicate: Record<string, unknown>): string | undefined {
  const buildDefinition = asRecord(predicate.buildDefinition);
  const external = asRecord(buildDefinition?.externalParameters);
  const workflow = asRecord(external?.workflow);
  const workflowRepo = normalizeGitRepository(stringValue(workflow?.repository));
  if (workflowRepo) return workflowRepo;

  const invocation = asRecord(predicate.invocation);
  const configSource = asRecord(invocation?.configSource);
  const configUri = normalizeGitRepository(stringValue(configSource?.uri));
  if (configUri) return configUri;

  for (const dependency of asArray(buildDefinition?.resolvedDependencies)) {
    const uri = normalizeGitRepository(stringValue(asRecord(dependency)?.uri));
    if (uri?.startsWith('https://github.com/')) return uri;
  }
  return undefined;
}

function rekorLogIndex(bundle: unknown): number | undefined {
  const material = asRecord(asRecord(bundle)?.verificationMaterial);
  const entries = asArray(material?.tlogEntries);
  for (const entry of entries) {
    const logIndex = numberValue(asRecord(entry)?.logIndex);
    if (logIndex !== undefined) return logIndex;
  }
  return undefined;
}

export function extractProvenanceVerification(
  statement: Record<string, unknown>,
  bundle: unknown,
  verified: boolean,
  reason: ProvenanceVerification['reason']
): ProvenanceVerification {
  const predicate = asRecord(statement.predicate) ?? {};
  const runDetails = asRecord(predicate.runDetails);
  const builder = stringValue(asRecord(runDetails?.builder)?.id) ?? stringValue(asRecord(predicate.builder)?.id);
  const sourceRepo = firstResolvedRepository(predicate);
  const commit = firstResolvedGitCommit(predicate);
  const rekorIndex = rekorLogIndex(bundle);

  return ProvenanceVerificationSchema.parse({
    verified,
    builder,
    source_repo: sourceRepo,
    commit,
    reason,
    rekor_log_index: rekorIndex
  });
}

export async function verifyNpmProvenance(
  purl: string,
  options: VerifyNpmProvenanceOptions = {}
): Promise<NpmProvenanceEvidence> {
  const parsed = npmPackageFromPurl(purl);
  const packageName = parsed?.packageName ?? '';
  const version = parsed?.version ?? '';
  const attestationUrl = parsed
    ? npmAttestationsUrl(packageName, version, options.registryBaseUrl)
    : npmAttestationsUrl('invalid', '0.0.0', options.registryBaseUrl);

  if (!parsed) {
    return noProvenance(purl, version, attestationUrl, 'verification-failed');
  }
  if (options.offline) {
    return noProvenance(purl, version, attestationUrl, 'network-error');
  }

  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(attestationUrl);
  } catch {
    return noProvenance(purl, version, attestationUrl, 'network-error');
  }

  if (response.status === 404) {
    return noProvenance(purl, version, attestationUrl, 'no-provenance');
  }
  if (!response.ok) {
    return noProvenance(purl, version, attestationUrl, 'network-error');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return noProvenance(purl, version, attestationUrl, 'verification-failed');
  }

  const match = findProvenanceAttestation(asArray(asRecord(body)?.attestations));
  if (!match) {
    return noProvenance(purl, version, attestationUrl, 'no-provenance');
  }
  if (!subjectMatches(match.statement, purl)) {
    return noProvenance(purl, version, attestationUrl, 'verification-failed');
  }

  const context: NpmProvenanceContext = {
    purl,
    packageName,
    version,
    attestationUrl,
    statement: match.statement,
    bundle: match.attestation.bundle
  };

  if (!options.verifier) {
    return {
      purl,
      version,
      predicateType: PROVENANCE_PREDICATE_TYPE,
      predicate: extractProvenanceVerification(
        match.statement,
        match.attestation.bundle,
        false,
        'verification-skipped'
      ),
      attestationUrl
    };
  }

  try {
    const verified = await options.verifier(context);
    const extracted = extractProvenanceVerification(
      match.statement,
      match.attestation.bundle,
      verified.verified,
      verified.verified ? 'provenance-verified' : 'verification-failed'
    );
    return {
      purl,
      version,
      predicateType: PROVENANCE_PREDICATE_TYPE,
      predicate: ProvenanceVerificationSchema.parse({ ...extracted, ...verified }),
      attestationUrl
    };
  } catch {
    return {
      purl,
      version,
      predicateType: PROVENANCE_PREDICATE_TYPE,
      predicate: extractProvenanceVerification(
        match.statement,
        match.attestation.bundle,
        false,
        'verification-failed'
      ),
      attestationUrl
    };
  }
}
