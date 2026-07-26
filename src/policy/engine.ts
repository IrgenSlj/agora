// The policy plane: real Cedar evaluation over the evidence Agora collected
// (AGORA_BRIEF_v2.md §7.1).
//
// Why a policy engine rather than more heuristics: heuristics answer "does this
// look bad to Agora", which is Agora's opinion. A policy answers "does this
// satisfy the rules THIS project agreed to", which is the user's decision,
// written down, versionable, reviewable in a pull request, and enforceable in
// CI. That difference is the product.
//
// cedar-wasm is ~12MB, so it is imported lazily: a `search` or `doctor` run
// that never evaluates a policy never pays for it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACT_ENTITY_TYPE,
  type BuildEntitiesInput,
  buildEntities,
  PROJECT_ENTITY_TYPE
} from './entities.js';

export type PolicyAction = 'Install' | 'Sync' | 'Serve';

export interface PolicyDecision {
  decision: 'allow' | 'deny';
  /** Policy ids that determined the answer — what to show the user. */
  determining: string[];
  /**
   * Policies that ERRORED during evaluation and were therefore skipped.
   *
   * This is the single most important field here. Cedar skips a policy that
   * reads a missing attribute and returns the remaining decision, so a `forbid`
   * with a typo — or one guarding on evidence Agora never collected — comes
   * back as `allow` that looks entirely normal. A non-empty `skipped` means the
   * decision was reached with rules switched off, and no caller may treat such
   * an `allow` as a clean result.
   */
  skipped: string[];
  /** Human-readable errors from evaluation; non-empty means the answer is suspect. */
  errors: string[];
  /** Set when the engine could not run at all, in which case `decision` is not meaningful. */
  unavailable?: string;
}

/**
 * True when the decision can be relied on: it ran, and no rule was skipped.
 * An `allow` that fails this is "we could not fully decide", not "permitted".
 */
export function isConclusive(decision: PolicyDecision): boolean {
  return !decision.unavailable && decision.skipped.length === 0 && decision.errors.length === 0;
}

export interface PolicySource {
  path: string;
  text: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the shipped baseline lives, in both src and dist layouts. */
export function baselinePolicyPath(): string {
  const candidates = [
    join(HERE, 'defaults', 'baseline.cedar'),
    join(HERE, '..', '..', 'src', 'policy', 'defaults', 'baseline.cedar')
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/** The shipped entity schema, in both src and dist layouts. */
export function schemaPath(): string {
  const candidates = [
    join(HERE, 'defaults', 'agora.cedarschema'),
    join(HERE, '..', '..', 'src', 'policy', 'defaults', 'agora.cedarschema')
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export function readSchema(): string {
  return readFileSync(schemaPath(), 'utf8');
}

export function readBaselinePolicy(): PolicySource {
  const path = baselinePolicyPath();
  return { path, text: readFileSync(path, 'utf8') };
}

/**
 * Loads the policy set: the shipped baseline first, then any project files.
 *
 * Order matters only for reporting — Cedar is order-independent and any
 * `forbid` beats every `permit`, which is exactly why a project can only ever
 * make the baseline stricter by adding files, never weaker.
 */
export function loadPolicies(files: readonly string[] = [], cwd = process.cwd()): PolicySource[] {
  const sources: PolicySource[] = [readBaselinePolicy()];
  for (const file of files) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) continue;
    sources.push({ path, text: readFileSync(path, 'utf8') });
  }
  return sources;
}

/**
 * Concatenates every source into one policy-set document.
 *
 * `StaticPolicySet` also accepts `Record<PolicyId, Policy>`, but that form is
 * one *policy* per id — handing it a file containing four policies fails to
 * parse at the second one. A single string lets Cedar parse the set itself and
 * assign the ids it then reports back in `diagnostics.reason`.
 */
function toPolicySet(sources: readonly PolicySource[]): string {
  return sources.map((source) => source.text).join('\n\n');
}

type CedarModule = typeof import('@cedar-policy/cedar-wasm/nodejs');

let cedarPromise: Promise<CedarModule | null> | null = null;

async function loadCedar(): Promise<CedarModule | null> {
  if (!cedarPromise) {
    cedarPromise = import('@cedar-policy/cedar-wasm/nodejs').catch(() => null);
  }
  return cedarPromise;
}

export interface EvaluateOptions extends BuildEntitiesInput {
  action?: PolicyAction;
  /** Extra `.cedar` files from `agora.toml → policy.files`. */
  policyFiles?: readonly string[];
  cwd?: string;
}

/**
 * Evaluates the policy set for one artifact and one action.
 *
 * An engine that cannot run reports `unavailable` rather than a decision. The
 * caller decides what to do with that — silently defaulting to `allow` would
 * make a broken policy engine indistinguishable from a permissive policy, and
 * defaulting to `deny` would brick the CLI on a packaging problem.
 */
export async function evaluatePolicy(options: EvaluateOptions): Promise<PolicyDecision> {
  const cedar = await loadCedar();
  if (!cedar) {
    return {
      decision: 'allow',
      determining: [],
      errors: [],
      skipped: [],
      unavailable: 'the Cedar engine could not be loaded'
    };
  }

  const sources = loadPolicies(options.policyFiles ?? [], options.cwd);
  const entities = buildEntities(options);

  try {
    const answer = cedar.isAuthorized({
      principal: { type: PROJECT_ENTITY_TYPE, id: options.projectId ?? 'default' },
      action: { type: 'Action', id: options.action ?? 'Install' },
      resource: { type: ARTIFACT_ENTITY_TYPE, id: options.purl },
      context: {},
      policies: { staticPolicies: toPolicySet(sources) } as never,
      entities: entities as never
    });

    if (answer.type === 'failure') {
      return {
        decision: 'allow',
        determining: [],
        skipped: [],
        errors: answer.errors.map((e) => e.message),
        unavailable: `policy evaluation failed: ${answer.errors[0]?.message ?? 'unknown'}`
      };
    }

    const response = answer.response;
    const diagnosticErrors = response.diagnostics?.errors ?? [];
    return {
      decision: response.decision,
      determining: [...(response.diagnostics?.reason ?? [])],
      // Cedar reports a skipped policy as a diagnostics error carrying its id.
      skipped: diagnosticErrors
        .map((e) => (typeof e === 'string' ? undefined : (e as { policyId?: string }).policyId))
        .filter((id): id is string => Boolean(id)),
      errors: diagnosticErrors.map((e) =>
        typeof e === 'string'
          ? e
          : (e as { error?: { message?: string } }).error?.message || String(e)
      )
    };
  } catch (err) {
    return {
      decision: 'allow',
      determining: [],
      skipped: [],
      errors: [],
      unavailable: err instanceof Error ? err.message : 'policy evaluation threw'
    };
  }
}

/**
 * Attribute names the schema declares on `Artifact`, parsed from the shipped
 * `.cedarschema`. Used for the unknown-attribute lint below.
 */
export function schemaAttributeNames(schemaText = readSchema()): Set<string> {
  const body = schemaText.match(/entity\s+Artifact\s*=\s*\{([\s\S]*?)\n\};/)?.[1] ?? '';
  const names = new Set<string>();
  for (const line of body.split('\n')) {
    const withoutComment = line.replace(/\/\/.*$/, '').trim();
    const match = withoutComment.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

/**
 * Attribute names a policy actually references, via `resource.x` or
 * `resource has x`.
 */
export function referencedAttributes(policyText: string): string[] {
  const found = new Set<string>();
  for (const m of policyText.matchAll(/resource\s+has\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1]) found.add(m[1]);
  }
  for (const m of policyText.matchAll(/resource\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

export interface PolicyLint {
  ok: boolean;
  /** Syntax errors — the file is not valid Cedar. */
  errors: string[];
  /**
   * Schema violations: attributes that do not exist, or optional ones read
   * without a `has` guard.
   *
   * These are the dangerous ones. A rule with a misspelt attribute parses
   * perfectly and then silently never fires — it is skipped at evaluation and
   * the decision comes back `allow`. Catching it here is the difference
   * between a typo and a policy someone trusts for a year without noticing it
   * does nothing.
   */
  schemaViolations: string[];
}

/**
 * Lints a policy file: syntax first, then validation against the shipped
 * entity schema. Used by `agora policy check`.
 */
export async function lintPolicyText(text: string): Promise<PolicyLint> {
  const cedar = await loadCedar();
  if (!cedar) {
    return { ok: false, errors: ['the Cedar engine could not be loaded'], schemaViolations: [] };
  }

  const parsed = cedar.checkParsePolicySet({ staticPolicies: text } as never);
  if (parsed.type !== 'success') {
    return { ok: false, errors: parsed.errors.map((e) => e.message), schemaViolations: [] };
  }

  let schemaViolations: string[] = [];
  try {
    const validation = cedar.validate({
      schema: readSchema() as never,
      policies: { staticPolicies: text } as never
    });
    if (validation.type === 'success') {
      schemaViolations = validation.validationErrors.map(
        (v) => `${v.policyId}: ${v.error.message}`
      );
    } else {
      schemaViolations = validation.errors.map((e) => e.message);
    }
  } catch (err) {
    schemaViolations = [err instanceof Error ? err.message : 'schema validation threw'];
  }

  // Cedar's own validator accepts `resource has madeUpName` — `has` on an
  // undeclared attribute is legal and simply evaluates false. That is precisely
  // the silent-never-fires case this plane exists to prevent, so check the
  // referenced names against the schema ourselves.
  const known = schemaAttributeNames();
  const unknown = referencedAttributes(text).filter((name) => !known.has(name));
  for (const name of unknown) {
    schemaViolations.push(
      `unknown attribute \`${name}\` — not declared on Artifact, so any rule reading it can never fire`
    );
  }

  return { ok: schemaViolations.length === 0, errors: [], schemaViolations };
}

/** Syntax-only check. Prefer {@link lintPolicyText}, which also catches typos. */
export async function validatePolicyText(
  text: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const cedar = await loadCedar();
  if (!cedar) return { ok: false, errors: ['the Cedar engine could not be loaded'] };

  const result = cedar.checkParsePolicySet({ staticPolicies: text } as never);
  if (result.type === 'success') return { ok: true };
  return { ok: false, errors: result.errors.map((e) => e.message) };
}
