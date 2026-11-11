// Cedar over agent actions: the policy plane.
//
// A repository's rules live in agora.cedar at its root, evaluated together
// with the shipped baseline. With an agora.cedar, anything no rule permits is
// denied: least privilege. Without one, Agora adds a single permit-all so only
// the baseline's forbids apply, and says the repository has no policy.
//
// cedar-wasm is imported lazily, so commands that never evaluate a policy
// never pay for it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CedarRequest } from './requests.js';

export const POLICY_FILE = 'agora.cedar';
const HERE = dirname(fileURLToPath(import.meta.url));

function shipped(name: string): string {
  const candidates = [
    join(HERE, 'defaults', name),
    join(HERE, '..', '..', 'src', 'policy', 'defaults', name)
  ];
  return candidates.find((p) => existsSync(p)) ?? (candidates[0] as string);
}

export const readSchema = (): string => readFileSync(shipped('agora.cedarschema'), 'utf8');
export const readBaseline = (): string => readFileSync(shipped('baseline.cedar'), 'utf8');

type Cedar = typeof import('@cedar-policy/cedar-wasm/nodejs');
let cedarPromise: Promise<Cedar | null> | null = null;
export function loadCedar(): Promise<Cedar | null> {
  cedarPromise ??= import('@cedar-policy/cedar-wasm/nodejs').catch(() => null);
  return cedarPromise;
}

export interface PolicySet {
  /** Policy id → text. Ids come from `@id("…")`, else `<source>#<n>`. */
  policies: Record<string, string>;
  /** False when the repository has no agora.cedar and a permit-all stands in. */
  project: boolean;
  /** Parse errors, by source. A set with errors must not be enforced. */
  errors: string[];
}

const ANNOTATED_ID = /@id\(\s*"([^"]+)"\s*\)/;

function split(cedar: Cedar, text: string, source: string, into: PolicySet): void {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== 'success') {
    into.errors.push(...parts.errors.map((e) => `${source}: ${e.message}`));
    return;
  }
  parts.policies.forEach((policy, n) => {
    const id = ANNOTATED_ID.exec(policy)?.[1] ?? `${source}#${n + 1}`;
    into.policies[into.policies[id] ? `${id}#${n + 1}` : id] = policy;
  });
}

/** Baseline plus `policyText` (or the repository's agora.cedar). */
export async function loadPolicySet(opts: {
  repo?: string;
  policyText?: string;
  source?: string;
}): Promise<PolicySet | undefined> {
  const cedar = await loadCedar();
  if (!cedar) return undefined;
  const set: PolicySet = { policies: {}, project: false, errors: [] };
  split(cedar, readBaseline(), 'baseline', set);
  let text = opts.policyText;
  let source = opts.source ?? POLICY_FILE;
  if (text === undefined && opts.repo && existsSync(join(opts.repo, POLICY_FILE))) {
    text = readFileSync(join(opts.repo, POLICY_FILE), 'utf8');
    source = POLICY_FILE;
  }
  if (text !== undefined) {
    set.project = true;
    split(cedar, text, source, set);
  } else {
    set.policies['no-policy-permit-all'] = 'permit (principal, action, resource);';
  }
  return set;
}

export interface Decision {
  decision: 'allow' | 'deny';
  /** Policies that produced the decision; empty on a deny means no rule permits it. */
  reasons: string[];
  /** Policies skipped because they errored. Non-empty means the answer is not conclusive. */
  errors: string[];
}

export async function evaluate(set: PolicySet, req: CedarRequest): Promise<Decision | undefined> {
  const cedar = await loadCedar();
  if (!cedar) return undefined;
  const answer = cedar.isAuthorized({
    principal: req.principal,
    action: { type: 'Action', id: req.action },
    resource: req.resource,
    context: {},
    policies: { staticPolicies: set.policies } as never,
    entities: req.entities as never
  });
  if (answer.type !== 'success') {
    return { decision: 'deny', reasons: [], errors: answer.errors.map((e) => e.message) };
  }
  const d = answer.response;
  return {
    decision: d.decision,
    reasons: [...d.diagnostics.reason],
    errors: d.diagnostics.errors.map((e) => `${e.policyId}: ${e.error.message}`)
  };
}

export function isConclusive(d: Decision): boolean {
  return d.errors.length === 0;
}

export interface PolicyLint {
  ok: boolean;
  /** Syntax errors: not valid Cedar. */
  errors: string[];
  /** Schema violations: unknown attributes, optional ones read without `has`, wrong types. */
  schemaViolations: string[];
}

/** Lints a policy text: syntax, then strict validation against the shipped schema. */
export async function lintPolicyText(text: string): Promise<PolicyLint> {
  const cedar = await loadCedar();
  if (!cedar)
    return { ok: false, errors: ['the Cedar engine could not be loaded'], schemaViolations: [] };
  const parsed = cedar.checkParsePolicySet({ staticPolicies: text } as never);
  if (parsed.type !== 'success') {
    return { ok: false, errors: parsed.errors.map((e) => e.message), schemaViolations: [] };
  }
  const v = cedar.validate({
    schema: readSchema() as never,
    policies: { staticPolicies: text } as never
  });
  const schemaViolations =
    v.type === 'success'
      ? v.validationErrors.map((e) => `${e.policyId}: ${e.error.message}`)
      : v.errors.map((e) => e.message);
  return { ok: schemaViolations.length === 0, errors: [], schemaViolations };
}
