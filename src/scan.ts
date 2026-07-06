import type { FederatedTool, OfficialStatus } from './federation/types.js';
import type { FetchLike } from './live.js';
import type { MarketplaceItem, PackageMarketplaceItem } from './marketplace.js';
import { getInstallKind, hasPermissions } from './marketplace.js';
import { fetchWithRetry } from './retry.js';
import { descriptionDigest } from './stack/capability-cache.js';
import type { McpTool } from './stack/mcp-probe.js';
import type { Permissions } from './types.js';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ScanCheck {
  name: string;
  label: string;
  status: CheckStatus;
  message: string;
}

export interface ScanResult {
  id: string;
  itemKind: 'package' | 'workflow';
  checks: ScanCheck[];
  summary: { pass: number; warn: number; fail: number };
}

export interface ScanOptions {
  fetcher?: FetchLike;
  now?: () => Date;
  githubToken?: string;
  offline?: boolean;
  /**
   * Federation trust inputs (P2 — brief "Trust gate over federation"). All
   * optional and offline-safe: when a field is absent, its corresponding
   * check is skipped entirely rather than fabricating a verdict from data
   * Agora doesn't have.
   */
  /** Official-registry lifecycle status, when the item resolved there. */
  officialStatus?: OfficialStatus;
  /** Tool schemas + MCP annotation hints from federation (e.g. Smithery) or a live probe. */
  tools?: FederatedTool[];
  /**
   * Observed tool schemas from a live MCP probe (src/stack/mcp-probe.ts).
   * Preferred over `tools` for the observed-permissions diff when present;
   * falls back to `tools` (pre-install, nothing to probe yet).
   */
  observedTools?: McpTool[];
  /**
   * Approved descriptionDigest baseline (rug-pull / description-drift
   * signal). Skipped when no baseline is on record yet.
   */
  previousDigest?: string;
}

function tally(checks: ScanCheck[]): { pass: number; warn: number; fail: number } {
  let pass = 0,
    warn = 0,
    fail = 0;
  for (const c of checks) {
    if (c.status === 'pass') pass++;
    else if (c.status === 'warn') warn++;
    else fail++;
  }
  return { pass, warn, fail };
}

function licenseCheck(status: CheckStatus, message: string): ScanCheck {
  return { name: 'license_present', label: 'License declared', status, message };
}

const DESCRIPTION_INJECTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bIMPORTANT\s*:/i, label: 'imperative marker' },
  { pattern: /\bbefore returning\b/i, label: 'response-control instruction' },
  {
    pattern: /\bignore (?:all )?(?:previous|prior) instructions\b/i,
    label: 'instruction override'
  },
  { pattern: /\brun\s+(?:cat|curl|wget|python|node|bash|sh)\b/i, label: 'runtime command' },
  { pattern: /\bsend\s+.*\b(?:secret|token|key|credential|env)\b/i, label: 'secret exfiltration' },
  {
    pattern: /~\/\.ssh|id_rsa|\.env\b|process\.env/i,
    label: 'secret path or environment reference'
  }
];

function checkDescriptionInjection(description: string): ScanCheck {
  const hits = DESCRIPTION_INJECTION_PATTERNS.filter(({ pattern }) => pattern.test(description));
  if (hits.length === 0) {
    return {
      name: 'description_injection',
      label: 'Description injection',
      status: 'pass',
      message: 'no suspicious instruction patterns'
    };
  }
  return {
    name: 'description_injection',
    label: 'Description injection',
    status: 'warn',
    message: `suspicious description pattern(s): ${hits.map((hit) => hit.label).join(', ')}`
  };
}

// ── registry_status (P2: official MCP Registry lifecycle) ──────────────────
// Optional/offline-safe: only emitted when the caller supplies a federation
// status (acquire.ts wires this from federatedFetchItem's officialStatus).
// Absent status means "we don't know" — say nothing rather than fabricate a
// pass. `deleted` (spam/malware/policy violation per the registry's own
// semantics — docs/OPEN_QUESTIONS.md OQ-3) is a hard block; `deprecated` is a
// warning; `active` passes.
function checkRegistryStatus(officialStatus: OfficialStatus): ScanCheck {
  if (officialStatus === 'deleted') {
    return {
      name: 'registry_status',
      label: 'Registry status',
      status: 'fail',
      message: 'official MCP Registry marked this server deleted (spam/malware/policy violation)'
    };
  }
  if (officialStatus === 'deprecated') {
    return {
      name: 'registry_status',
      label: 'Registry status',
      status: 'warn',
      message: 'official MCP Registry marked this server deprecated'
    };
  }
  return {
    name: 'registry_status',
    label: 'Registry status',
    status: 'pass',
    message: 'active in the official MCP Registry'
  };
}

// MCP tool `name` fields are conventionally snake_case (`delete_file`,
// `run_shell_command`) or camelCase — and `_` counts as a `\w` character, so a
// plain `\bword\b` regex never matches inside `delete_file` (no boundary
// either side of "delete"). Split snake_case/kebab-case/camelCase into
// space-separated words first so every heuristic below actually sees them.
function tokenizeToolText(text: string): string {
  return text.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

// ── annotation_hints (P2: MCP tool annotation hints) ────────────────────────
// Optional/offline-safe: skipped when no tool schemas are available, or when
// none of them carry an `annotations` object at all (e.g. the official
// registry alone never supplies hints — only Smithery/a live probe do, see
// OQ-3). Flags destructive/open-world tools and write-shaped tools that don't
// declare readOnlyHint — folded into the permission heuristics as a warning,
// same spirit as description_injection: flag, don't auto-fail.
const WRITE_SHAPED_TOOL_PATTERN =
  /\b(write|create|delete|remove|update|modify|patch|insert|drop|exec|execute|run|set|send|publish|push|deploy|install|uninstall)\b/i;

function isWriteShapedTool(tool: FederatedTool): boolean {
  const haystack = tokenizeToolText(`${tool.name} ${tool.description ?? ''}`);
  return WRITE_SHAPED_TOOL_PATTERN.test(haystack);
}

function checkAnnotationHints(tools: FederatedTool[] | undefined): ScanCheck | null {
  if (!tools || tools.length === 0) return null;
  const withAnnotations = tools.filter((t) => t.annotations);
  if (withAnnotations.length === 0) return null;

  const hits: string[] = [];
  for (const tool of withAnnotations) {
    const a = tool.annotations!;
    if (a.destructiveHint) hits.push(`${tool.name}: destructiveHint`);
    if (a.openWorldHint) hits.push(`${tool.name}: openWorldHint`);
    if (!a.readOnlyHint && isWriteShapedTool(tool)) {
      hits.push(`${tool.name}: write-shaped tool without readOnlyHint`);
    }
  }

  if (hits.length === 0) {
    return {
      name: 'annotation_hints',
      label: 'Tool annotation hints',
      status: 'pass',
      message: 'no destructive/open-world hints, no unmarked write-shaped tools'
    };
  }
  return {
    name: 'annotation_hints',
    label: 'Tool annotation hints',
    status: 'warn',
    message: `flagged: ${hits.join('; ')}`
  };
}

// ── observed_permissions (P2: declared-vs-observed capability diff) ────────
// Optional/offline-safe: skipped without tool schemas to observe (nothing to
// diff pre-probe). Heuristic only — tool names/descriptions are text, not
// executed code; a name-based signal is honest about what it is (a red-flag
// detector, not a sandbox — see the gate's honest-limits copy).
const OBSERVED_CAPABILITY_PATTERNS: Record<'fs' | 'net' | 'exec', RegExp> = {
  fs: /\b(file|files|directory|dir|filesystem|path)\b/i,
  net: /\b(http|https|fetch|request|url|api|download|upload|webhook)\b/i,
  exec: /\b(exec|execute|shell|command|spawn|subprocess|bash|script)\b/i
};

/**
 * Exported for the TUI Acquire page's declared-vs-observed permission rows
 * (trustPanel) — the same heuristic `checkObservedPermissions` already runs
 * for the `observed_permissions` scan check, reused directly instead of
 * re-parsing that check's free-text message.
 */
export function observedCapabilities(
  tools: ReadonlyArray<{ name: string; description?: string }>
): Set<'fs' | 'net' | 'exec'> {
  const observed = new Set<'fs' | 'net' | 'exec'>();
  for (const tool of tools) {
    const haystack = tokenizeToolText(`${tool.name} ${tool.description ?? ''}`);
    for (const [cap, pattern] of Object.entries(OBSERVED_CAPABILITY_PATTERNS) as Array<
      ['fs' | 'net' | 'exec', RegExp]
    >) {
      if (pattern.test(haystack)) observed.add(cap);
    }
  }
  return observed;
}

function checkObservedPermissions(
  declared: Permissions | undefined,
  tools: ReadonlyArray<{ name: string; description?: string }> | undefined
): ScanCheck | null {
  if (!tools || tools.length === 0) return null;
  const observed = observedCapabilities(tools);
  const base = { name: 'observed_permissions', label: 'Observed vs declared permissions' } as const;

  if (observed.size === 0) {
    return { ...base, status: 'pass', message: 'no fs/net/exec signal observed in tool schemas' };
  }

  const declaredSet = new Set<'fs' | 'net' | 'exec'>();
  if (declared?.fs?.length) declaredSet.add('fs');
  if (declared?.net?.length) declaredSet.add('net');
  if (declared?.exec?.length) declaredSet.add('exec');

  const undeclared = [...observed].filter((cap) => !declaredSet.has(cap)).sort();
  if (undeclared.length === 0) {
    return {
      ...base,
      status: 'pass',
      message: `observed capabilities (${[...observed].sort().join(', ')}) match declared permissions`
    };
  }
  return {
    ...base,
    status: 'warn',
    message: `tool schemas suggest ${undeclared.join(', ')} not declared in the permissions manifest`
  };
}

// ── description_drift (P2: rug-pull baseline diff, inside the gate) ────────
// Optional/offline-safe: skipped without both a previous baseline and current
// tool schemas to diff. `agora doctor --probe` already surfaces drift for
// *installed* servers over time; this brings the same signal into the
// pre-install/pre-write gate itself when a baseline already exists (e.g. a
// cloned `agora.toml` profile ships one — see `sync --from`'s flagship demo).
function checkDescriptionDrift(
  previousDigest: string | undefined,
  tools: ReadonlyArray<McpTool> | undefined
): ScanCheck | null {
  if (!previousDigest || !tools || tools.length === 0) return null;
  const currentDigest = descriptionDigest(tools);
  const base = { name: 'description_drift', label: 'Description drift' } as const;
  if (currentDigest === previousDigest) {
    return { ...base, status: 'pass', message: 'tool schemas match the approved baseline' };
  }
  return {
    ...base,
    status: 'warn',
    message:
      'tool descriptions/schemas changed since the approved baseline (possible rug-pull) — review before proceeding'
  };
}

// Returns repo_reachable plus (when the repo is reachable) license_present,
// both derived from a single GitHub repos API call. A missing license is a
// warning, never a hard fail — many legitimate repos lack a detected license.
async function checkRepo(item: PackageMarketplaceItem, opts: ScanOptions): Promise<ScanCheck[]> {
  const base: Omit<ScanCheck, 'status' | 'message'> = {
    name: 'repo_reachable',
    label: 'Repository reachable'
  };
  if (!item.repository) {
    return [{ ...base, status: 'pass', message: 'no repository field, skipped' }];
  }
  if (opts.offline) {
    return [{ ...base, status: 'warn', message: 'offline mode, not verified' }];
  }

  let url: URL;
  try {
    url = new URL(item.repository);
  } catch {
    return [{ ...base, status: 'pass', message: 'non-github repository, skipped' }];
  }

  if (url.hostname !== 'github.com') {
    return [{ ...base, status: 'pass', message: 'non-github repository, skipped' }];
  }

  const path = url.pathname
    .replace(/^\//, '')
    .replace(/\.git$/, '')
    .split('/')
    .slice(0, 2)
    .join('/');
  const apiUrl = `https://api.github.com/repos/${path}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (opts.githubToken) headers.Authorization = `Bearer ${opts.githubToken}`;

  const fetcher = opts.fetcher ?? globalThis.fetch;
  try {
    const res = await fetchWithRetry(
      apiUrl,
      { headers, signal: AbortSignal.timeout(8000) },
      { maxRetries: 2, fetcher }
    );
    if (res.status === 200) {
      const reachable: ScanCheck = { ...base, status: 'pass', message: `github.com/${path}` };
      let license: ScanCheck;
      try {
        const body = (await res.json()) as { license?: { spdx_id?: string } | null };
        const spdx = body.license?.spdx_id;
        license =
          spdx && spdx !== 'NOASSERTION'
            ? licenseCheck('pass', spdx)
            : licenseCheck('warn', 'no license detected on the repository');
      } catch {
        license = licenseCheck('warn', 'could not read license metadata');
      }
      return [reachable, license];
    }
    if (res.status === 404) return [{ ...base, status: 'fail', message: 'repo not found' }];
    return [{ ...base, status: 'warn', message: 'could not verify (rate limited or network)' }];
  } catch {
    return [{ ...base, status: 'warn', message: 'could not verify (rate limited or network)' }];
  }
}

async function checkNpmExists(item: PackageMarketplaceItem, opts: ScanOptions): Promise<ScanCheck> {
  const base: Omit<ScanCheck, 'status' | 'message'> = {
    name: 'npm_exists',
    label: 'npm package exists'
  };
  if (!item.npmPackage) return { ...base, status: 'pass', message: 'no npm package, skipped' };
  if (opts.offline) return { ...base, status: 'warn', message: 'offline mode, not verified' };

  const encoded = encodeURIComponent(item.npmPackage).replace('%40', '@').replace('%2F', '/');
  const fetcher = opts.fetcher ?? globalThis.fetch;
  try {
    const res = await fetchWithRetry(
      `https://registry.npmjs.org/${encoded}/latest`,
      {
        signal: AbortSignal.timeout(8000)
      },
      { maxRetries: 2, fetcher }
    );
    if (res.status === 200) {
      const json = (await res.json()) as { version?: string };
      return {
        ...base,
        status: 'pass',
        message: `${item.npmPackage}@${json.version ?? 'unknown'}`
      };
    }
    if (res.status === 404) return { ...base, status: 'fail', message: 'package not found on npm' };
    return { ...base, status: 'warn', message: 'could not verify (network)' };
  } catch {
    return { ...base, status: 'warn', message: 'could not verify (network)' };
  }
}

async function scanPackage(item: PackageMarketplaceItem, opts: ScanOptions): Promise<ScanCheck[]> {
  const checks: ScanCheck[] = [];

  // 1. permissions_declared
  const hasPerm = hasPermissions(item.permissions);
  if (hasPerm) {
    const parts: string[] = [];
    if (item.permissions?.fs?.length) parts.push('fs');
    if (item.permissions?.net?.length) parts.push('net');
    if (item.permissions?.exec?.length) parts.push('exec');
    checks.push({
      name: 'permissions_declared',
      label: 'Permissions declared',
      status: 'pass',
      message: parts.join('|')
    });
  } else {
    checks.push({
      name: 'permissions_declared',
      label: 'Permissions declared',
      status: 'warn',
      message: 'no permissions manifest declared'
    });
  }

  // 2. permission_consistency
  const kind = getInstallKind(item);
  if (kind === 'git-clone' && !item.permissions?.exec?.length) {
    checks.push({
      name: 'permission_consistency',
      label: 'Permission consistency',
      status: 'warn',
      message: 'git-clone install runs shell commands; declare exec'
    });
  } else if (kind === 'mcp-config-patch' && item.npmPackage && !item.permissions?.exec?.length) {
    checks.push({
      name: 'permission_consistency',
      label: 'Permission consistency',
      status: 'warn',
      message: 'npx invocation runs binaries; declare exec'
    });
  } else {
    checks.push({
      name: 'permission_consistency',
      label: 'Permission consistency',
      status: 'pass',
      message: 'declared permissions match install kind'
    });
  }

  // 3. repo_reachable (+ license_present when reachable)
  if (item.repository) {
    checks.push(...(await checkRepo(item, opts)));
  }

  // 4. npm_exists
  if (item.npmPackage) {
    checks.push(await checkNpmExists(item, opts));
  }

  // 5. recently_active
  if (item.pushedAt) {
    const now = opts.now ? opts.now() : new Date();
    const days = Math.floor((now.getTime() - new Date(item.pushedAt).getTime()) / 86_400_000);
    if (days <= 365) {
      checks.push({
        name: 'recently_active',
        label: 'Recently active',
        status: 'pass',
        message: `pushed ${days}d ago`
      });
    } else {
      checks.push({
        name: 'recently_active',
        label: 'Recently active',
        status: 'warn',
        message: `last push ${days}d ago — may be unmaintained`
      });
    }
  }

  // 6. flag_count_low
  const flags = item.flagCount ?? 0;
  if (flags < 3) {
    checks.push({
      name: 'flag_count_low',
      label: 'Flag count low',
      status: 'pass',
      message: `${flags} flags`
    });
  } else if (flags < 10) {
    checks.push({
      name: 'flag_count_low',
      label: 'Flag count low',
      status: 'warn',
      message: `${flags} flags — under review threshold`
    });
  } else {
    checks.push({
      name: 'flag_count_low',
      label: 'Flag count low',
      status: 'fail',
      message: `${flags} flags — would auto-hide`
    });
  }

  // 7. registry_status (P2, optional/offline-safe)
  if (opts.officialStatus !== undefined) {
    checks.push(checkRegistryStatus(opts.officialStatus));
  }

  // 8. annotation_hints (P2, optional/offline-safe)
  const annotationCheck = checkAnnotationHints(opts.tools);
  if (annotationCheck) checks.push(annotationCheck);

  // 9. observed_permissions (P2, optional/offline-safe)
  const observedCheck = checkObservedPermissions(
    item.permissions,
    opts.observedTools ?? opts.tools
  );
  if (observedCheck) checks.push(observedCheck);

  // 10. description_drift (P2, optional/offline-safe)
  const driftCheck = checkDescriptionDrift(opts.previousDigest, opts.observedTools ?? opts.tools);
  if (driftCheck) checks.push(driftCheck);

  return checks;
}

export async function scanItem(item: MarketplaceItem, opts: ScanOptions = {}): Promise<ScanResult> {
  let checks: ScanCheck[];

  if (item.kind === 'workflow') {
    const n = (item as { flagCount?: number }).flagCount ?? 0;
    checks = [
      {
        name: 'workflow_kind',
        label: 'Workflow kind',
        status: 'pass',
        message: 'Workflow items are inert prompts — no install side effects to scan.'
      },
      {
        name: 'flag_count_low',
        label: 'Flag count low',
        status: n < 3 ? 'pass' : n < 10 ? 'warn' : 'fail',
        message:
          n < 3
            ? `${n} flags`
            : n < 10
              ? `${n} flags — under review threshold`
              : `${n} flags — would auto-hide`
      },
      checkDescriptionInjection(item.description)
    ];
  } else {
    checks = await scanPackage(item, opts);
    checks.push(checkDescriptionInjection(item.description));
  }

  return {
    id: item.id,
    itemKind: item.kind,
    checks,
    summary: tally(checks)
  };
}
