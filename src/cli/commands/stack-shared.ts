/**
 * Shared plumbing for `agora plan` / `agora apply` / `agora sync` (P3).
 * `sync` = `plan && apply` for continuity: all three commands resolve the
 * same manifest/target/scope arguments and drive the same underlying diff
 * (stack/sync.ts planSync/planInstructionsSync) and reconcile
 * (applySync/applyInstructionsSync) engines, so behavior never drifts
 * between them.
 */
import { ALL_ADAPTERS, detectTools } from '../../stack/registry.js';
import { manifestPath, readManifest, loadManifestFromSource } from '../../stack/manifest.js';
import {
  planSync,
  applySync,
  planInstructionsSync,
  applyInstructionsSync,
  gateManifestForSync,
  type ToolSyncPlan,
  type GateReport
} from '../../stack/sync.js';
import type { AgentToolId, StackEnv } from '../../stack/types.js';
import type { StackManifest } from '../../stack/manifest.js';
import type { CliIo, ParsedArgs } from '../flags.js';
import { stringFlag, usageError } from '../helpers.js';
import type { Theme } from '../theme.js';

export const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

export interface ResolvedStackArgs {
  env: StackEnv;
  manifest: StackManifest;
  targets: AgentToolId[];
  scope: 'project' | 'user';
  prune: boolean;
  fromFlag?: string;
  isRemoteSource: boolean;
}

export type ResolveResult =
  | { ok: true; value: ResolvedStackArgs }
  | { ok: false; code: number };

/** Parse + validate --tool/--scope/--prune/--from and load the manifest. */
export async function resolveStackArgs(parsed: ParsedArgs, io: CliIo): Promise<ResolveResult> {
  const env: StackEnv = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  const toolFlag = stringFlag(parsed, 'tool');
  if (toolFlag !== undefined && !KNOWN_TOOL_IDS.includes(toolFlag as AgentToolId)) {
    return {
      ok: false,
      code: usageError(io, `Unknown tool: ${toolFlag}. Valid values: ${KNOWN_TOOL_IDS.join(', ')}`)
    };
  }

  const scopeFlag = stringFlag(parsed, 'scope');
  if (scopeFlag !== undefined && scopeFlag !== 'project' && scopeFlag !== 'user') {
    return {
      ok: false,
      code: usageError(io, `Invalid scope: ${scopeFlag}. Must be "project" or "user".`)
    };
  }
  const scope: 'project' | 'user' = scopeFlag === 'user' ? 'user' : 'project';
  const prune = Boolean(parsed.flags.prune);
  const fromFlag = stringFlag(parsed, 'from');
  const isRemoteSource = fromFlag !== undefined && /^https?:\/\//i.test(fromFlag);

  let manifest: StackManifest;
  if (fromFlag !== undefined) {
    try {
      manifest = await loadManifestFromSource(fromFlag, { cwd: io.cwd, fetcher: io.fetcher });
    } catch (e) {
      return { ok: false, code: usageError(io, e instanceof Error ? e.message : String(e)) };
    }
  } else {
    const mPath = manifestPath(env);
    const loaded = readManifest(mPath);
    if (loaded === null) {
      return {
        ok: false,
        code: usageError(
          io,
          `No agora.toml manifest found at ${mPath}. ` +
            'Run `agora freeze --write` to create one from your current stack.'
        )
      };
    }
    manifest = loaded;
  }

  let targets: AgentToolId[];
  if (toolFlag) {
    targets = [toolFlag as AgentToolId];
  } else {
    const detected = detectTools(env);
    targets = detected.filter((t) => t.present).map((t) => t.adapter.id as AgentToolId);
    if (targets.length === 0) targets = KNOWN_TOOL_IDS;
  }

  return { ok: true, value: { env, manifest, targets, scope, prune, fromFlag, isRemoteSource } };
}

export interface CombinedPlan {
  servers: ToolSyncPlan[];
  instructions: ToolSyncPlan[];
}

export async function computePlan(args: ResolvedStackArgs, io: CliIo): Promise<CombinedPlan> {
  const servers = planSync(args.manifest, args.env, args.targets, args.scope, args.prune);
  const instructions = await planInstructionsSync(
    args.manifest,
    args.env,
    args.targets,
    args.scope,
    args.prune,
    { fetcher: io.fetcher, baseSource: args.isRemoteSource ? args.fromFlag : undefined }
  );
  return { servers, instructions };
}

export async function computeApply(args: ResolvedStackArgs, io: CliIo): Promise<CombinedPlan> {
  const servers = applySync(args.manifest, args.env, args.targets, args.scope, args.prune);
  const instructions = await applyInstructionsSync(
    args.manifest,
    args.env,
    args.targets,
    args.scope,
    args.prune,
    { fetcher: io.fetcher, baseSource: args.isRemoteSource ? args.fromFlag : undefined }
  );
  return { servers, instructions };
}

export function combinedHasChanges(plan: CombinedPlan): boolean {
  const hasAny = (plans: ToolSyncPlan[]) =>
    plans.some(
      (p) =>
        p.change.added.length > 0 || p.change.updated.length > 0 || p.change.removed.length > 0
    );
  return hasAny(plan.servers) || hasAny(plan.instructions);
}

export async function runGate(args: ResolvedStackArgs, io: CliIo): Promise<GateReport> {
  return gateManifestForSync(args.manifest, {
    fetcher: io.fetcher,
    cwd: io.cwd,
    baseSource: args.isRemoteSource ? args.fromFlag : undefined
  });
}

export function formatToolPlans(title: string, plans: ToolSyncPlan[], theme: Theme): string {
  const lines: string[] = [theme.accent(title)];
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;

  for (const p of plans) {
    const locationLabel = p.location ? p.location.path : '(no location)';
    lines.push(`  ${p.tool}  →  ${locationLabel}`);

    if (p.location === null) {
      for (const s of p.skipped) {
        lines.push(
          `    ${theme.dim(`skipped: ${s.name === '*' ? '<all>' : s.name} (${s.reason})`)}`
        );
      }
      continue;
    }

    for (const name of p.change.added) {
      lines.push(`    + ${name}`);
      totalAdded++;
    }
    for (const name of p.change.updated) {
      lines.push(`    ~ ${name}`);
      totalUpdated++;
    }
    for (const name of p.change.removed) {
      lines.push(`    - ${name}`);
      totalRemoved++;
    }
    for (const s of p.skipped) {
      lines.push(`    ${theme.dim(`skipped: ${s.name} (${s.reason})`)}`);
    }

    const hasChanges =
      p.change.added.length > 0 ||
      p.change.updated.length > 0 ||
      p.change.removed.length > 0 ||
      p.skipped.length > 0;
    if (!hasChanges) {
      lines.push(`    ${theme.dim('(no changes)')}`);
    }
  }

  lines.push('');
  lines.push(
    theme.muted(`Total: +${totalAdded} added, ~${totalUpdated} updated, -${totalRemoved} removed`)
  );

  return lines.join('\n');
}

export function formatGateBlocked(gate: GateReport, theme: Theme): string {
  const lines: string[] = [theme.accent('agora — scan gate blocked'), ''];
  for (const entry of gate.blocked) {
    lines.push(`  ${entry.kind} "${entry.name}":`);
    for (const check of entry.scan.checks.filter((c) => c.status === 'fail')) {
      lines.push(`    ✗ ${check.label} — ${check.message}`);
    }
  }
  lines.push('');
  lines.push(theme.muted('Nothing written. Fix the flagged entries and re-run.'));
  return lines.join('\n');
}
