// agora.cedar → Claude Code settings.
//
// Two layers, per https://code.claude.com/docs/en/permissions and /hooks
// (read 2026-11-11):
//
//   1. Hooks enforce the whole policy. PreToolUse runs before Claude Code's
//      own permission check, and its deny holds even against an allow rule,
//      so `agora hook check` evaluating agora.cedar is exact enforcement.
//   2. `permissions.allow` rules are compiled from the permits that translate
//      faithfully, so permitted actions stop prompting. They only ever mirror a
//      permit the repository's own agora.cedar states, written by a person
//      running `agora apply`; Agora never grants anything the policy does not.
//
// Every rule is accounted for: compiled to a native rule, enforced by the hook
// only, or listed as something Claude Code cannot see at all.

import { hookConfig } from '../cli/commands/hook.js';
import { CLAUDE_CODE_GAPS } from './gaps.js';

export interface CompiledRule {
  policy: string;
  native: string[];
}

export interface HookOnly {
  policy: string;
  why: string;
}

export interface ClaudeCodeCompilation {
  allow: string[];
  compiled: CompiledRule[];
  hookOnly: HookOnly[];
  notEnforced: string[];
  hooks: ReturnType<typeof hookConfig>;
}

export { CLAUDE_CODE_GAPS } from './gaps.js';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function attrOf(node: unknown): string | undefined {
  if (!isObj(node) || !isObj(node['.'])) return undefined;
  const dot = node['.'] as Json;
  return isObj(dot.left) && (dot.left as Json).Var === 'resource' && typeof dot.attr === 'string'
    ? dot.attr
    : undefined;
}

const value = (node: unknown): unknown => (isObj(node) && 'Value' in node ? node.Value : undefined);

function conjuncts(node: unknown): unknown[] {
  if (isObj(node) && isObj(node['&&'])) {
    const and = node['&&'] as Json;
    return [...conjuncts(and.left), ...conjuncts(and.right)];
  }
  return [node];
}

/** `[…].contains(resource.attr)` → the string values, or undefined. */
function containsList(node: unknown, attr: string): string[] | undefined {
  if (!isObj(node) || !isObj(node.contains)) return undefined;
  const c = node.contains as Json;
  if (attrOf(c.right) !== attr || !isObj(c.left) || !Array.isArray((c.left as Json).Set))
    return undefined;
  const values = ((c.left as Json).Set as unknown[]).map(value);
  return values.every((v) => typeof v === 'string') ? (values as string[]) : undefined;
}

/** `resource.attr == "v"` → v. */
function equals(node: unknown, attr: string): unknown {
  if (!isObj(node) || !isObj(node['=='])) return undefined;
  const eq = node['=='] as Json;
  return attrOf(eq.left) === attr ? value(eq.right) : undefined;
}

/** `resource.path like "dir/*"` with only literals before one trailing wildcard → "dir". */
function likePrefix(node: unknown): string | undefined {
  if (!isObj(node) || !isObj(node.like)) return undefined;
  const like = node.like as Json;
  if (attrOf(like.left) !== 'path' || !Array.isArray(like.pattern)) return undefined;
  const pattern = like.pattern as unknown[];
  if (pattern.at(-1) !== 'Wildcard') return undefined;
  const chars = pattern
    .slice(0, -1)
    .map((p) => (isObj(p) && typeof p.Literal === 'string' ? p.Literal : null));
  if (chars.some((c) => c === null)) return undefined;
  const text = chars.join('');
  return text.endsWith('/') && text.length > 1 ? text.slice(0, -1) : undefined;
}

// Characters Claude Code's gitignore-style rules would read as syntax.
const SAFE_PATH = /^[A-Za-z0-9._\-/@+]+$/;
const SAFE_NAME = /^[A-Za-z0-9._+-]+$/;
const mcpName = (s: string) => s.replace(/[.\s]/g, '_');

/** Native Claude Code allow rules for one policy, or the reason there are none. */
export function translate(est: Json): { native: string[] } | { why: string } {
  if (est.effect !== 'permit')
    return { why: 'a forbid rule: enforced by the hook, never as an allow' };
  const principal = est.principal as Json;
  const resource = est.resource as Json;
  const action = est.action as Json;
  if (principal?.op !== 'All' || resource?.op !== 'All')
    return { why: 'constrains principal or resource scope' };
  const act = action?.op === '==' && isObj(action.entity) ? (action.entity as Json).id : undefined;
  const conds = (est.conditions as Json[] | undefined) ?? [];
  if (typeof act !== 'string' || conds.length !== 1 || conds[0]?.kind !== 'when') {
    return { why: 'not a single-action rule with one `when` condition' };
  }
  const parts = conjuncts(conds[0]?.body);

  if ((act === 'read' || act === 'write') && parts.length === 1) {
    const tool = act === 'read' ? 'Read' : 'Edit';
    const dir = likePrefix(parts[0]);
    if (dir && SAFE_PATH.test(dir)) return { native: [`${tool}(/${dir}/**)`] };
    const file = equals(parts[0], 'path');
    if (typeof file === 'string' && SAFE_PATH.test(file) && !file.startsWith('class:')) {
      return { native: [`${tool}(/${file})`] };
    }
    return {
      why: 'path condition has no exact Claude Code equivalent (outside the repository, or a pattern)'
    };
  }
  if (act === 'exec' && parts.length === 1) {
    const names = containsList(parts[0], 'name');
    if (names?.every((n) => SAFE_NAME.test(n))) return { native: names.map((n) => `Bash(${n} *)`) };
  }
  if (act === 'connect' && parts.length === 1) {
    const hosts = containsList(parts[0], 'host');
    if (hosts?.every((h) => /^[A-Za-z0-9.-]+$/.test(h)))
      return { native: hosts.map((h) => `WebFetch(domain:${h})`) };
  }
  if (act === 'call') {
    const mcpTrue = parts.some((p) => attrOf(p) === 'mcp');
    const mcpFalse = parts.some(
      (p) => isObj(p) && isObj(p['!']) && attrOf((p['!'] as Json).arg) === 'mcp'
    );
    const names = parts.map((p) => containsList(p, 'name')).find(Boolean);
    const server = parts.map((p) => equals(p, 'server')).find((v) => typeof v === 'string') as
      | string
      | undefined;
    if (mcpTrue && server && names && parts.length === 3) {
      return { native: names.map((n) => `mcp__${mcpName(server)}__${mcpName(n)}`) };
    }
    if (mcpFalse && names && parts.length === 2 && names.every((n) => SAFE_NAME.test(n))) {
      return { native: names };
    }
  }
  return { why: 'condition shape has no exact Claude Code equivalent' };
}

export function compileClaudeCode(policies: Record<string, Json>): ClaudeCodeCompilation {
  const compiled: CompiledRule[] = [];
  const hookOnly: HookOnly[] = [];
  for (const [policy, est] of Object.entries(policies)) {
    const t = translate(est);
    if ('native' in t) compiled.push({ policy, native: t.native });
    else hookOnly.push({ policy, why: t.why });
  }
  const allow = [...new Set(compiled.flatMap((c) => c.native))].sort();
  return { allow, compiled, hookOnly, notEnforced: CLAUDE_CODE_GAPS, hooks: hookConfig() };
}
