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
  /** Human-readable errors from evaluation; non-empty means the answer is suspect. */
  errors: string[];
  /** Set when the engine could not run at all, in which case `decision` is not meaningful. */
  unavailable?: string;
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
        errors: answer.errors.map((e) => e.message),
        unavailable: `policy evaluation failed: ${answer.errors[0]?.message ?? 'unknown'}`
      };
    }

    const response = answer.response;
    return {
      decision: response.decision,
      determining: [...(response.diagnostics?.reason ?? [])],
      errors: (response.diagnostics?.errors ?? []).map((e) =>
        typeof e === 'string' ? e : (e as { message?: string }).message || String(e)
      )
    };
  } catch (err) {
    return {
      decision: 'allow',
      determining: [],
      errors: [],
      unavailable: err instanceof Error ? err.message : 'policy evaluation threw'
    };
  }
}

/** Parses a policy file without evaluating it — used by `agora policy check`. */
export async function validatePolicyText(
  text: string
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const cedar = await loadCedar();
  if (!cedar) return { ok: false, errors: ['the Cedar engine could not be loaded'] };

  const result = cedar.checkParsePolicySet({ staticPolicies: text } as never);
  if (result.type === 'success') return { ok: true };
  return { ok: false, errors: result.errors.map((e) => e.message) };
}
