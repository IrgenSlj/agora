import { ALL_ADAPTERS, detectTools } from '../../stack/registry.js';
import { manifestPath, readManifest } from '../../stack/manifest.js';
import { planSync, applySync, type ToolSyncPlan } from '../../stack/sync.js';
import type { AgentToolId, StackEnv } from '../../stack/types.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError } from '../helpers.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

function formatPlan(plan: ToolSyncPlan[], style: { dim: (s: string) => string }): string {
  const lines: string[] = [];
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;

  for (const p of plan) {
    const toolLabel = p.tool;
    const locationLabel = p.location ? p.location.path : '(no location)';
    lines.push(`  ${toolLabel}  →  ${locationLabel}`);

    if (p.location === null) {
      for (const s of p.skipped) {
        lines.push(
          `    ${style.dim(`skipped: ${s.name === '*' ? '<all>' : s.name} (${s.reason})`)}`
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
      lines.push(`    ${style.dim(`skipped: ${s.name} (${s.reason})`)}`);
    }

    const hasChanges =
      p.change.added.length > 0 ||
      p.change.updated.length > 0 ||
      p.change.removed.length > 0 ||
      p.skipped.length > 0;
    if (!hasChanges) {
      lines.push(`    ${style.dim('(no changes)')}`);
    }
  }

  lines.push('');
  lines.push(
    style.dim(`Total: +${totalAdded} added, ~${totalUpdated} updated, -${totalRemoved} removed`)
  );

  return lines.join('\n');
}

export const commandSync: CommandHandler = async (parsed, io, style) => {
  const env: StackEnv = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  // --tool filter
  const toolFlag = stringFlag(parsed, 'tool');
  if (toolFlag !== undefined) {
    if (!KNOWN_TOOL_IDS.includes(toolFlag as AgentToolId)) {
      return usageError(
        io,
        `Unknown tool: ${toolFlag}. Valid values: ${KNOWN_TOOL_IDS.join(', ')}`
      );
    }
  }

  // --scope (default project)
  const scopeFlag = stringFlag(parsed, 'scope');
  if (scopeFlag !== undefined && scopeFlag !== 'project' && scopeFlag !== 'user') {
    return usageError(io, `Invalid scope: ${scopeFlag}. Must be "project" or "user".`);
  }
  const scope: 'project' | 'user' = scopeFlag === 'user' ? 'user' : 'project';

  // --prune
  const prune = Boolean(parsed.flags.prune);

  // --write / --yes gating
  const doWrite = Boolean(parsed.flags.write);
  const doYes = Boolean(parsed.flags.yes);

  if (doWrite && !doYes) {
    return usageError(
      io,
      'Refusing to write: --write requires --yes to confirm. ' +
        'Run with --write --yes to apply changes, or without --write to preview (dry-run).'
    );
  }

  // Read manifest
  const mPath = manifestPath(env);
  const manifest = readManifest(mPath);
  if (manifest === null) {
    return usageError(
      io,
      `No agora.toml manifest found at ${mPath}. ` +
        'Run `agora freeze --write` to create one from your current stack.'
    );
  }

  // Parse errors from readManifest are thrown; wrap them
  const mcpCount = Object.keys(manifest.mcp).length;

  // Determine target tools
  let targets: AgentToolId[];
  if (toolFlag) {
    targets = [toolFlag as AgentToolId];
  } else {
    // All detected-present tools
    const detected = detectTools(env);
    targets = detected.filter((t) => t.present).map((t) => t.adapter.id as AgentToolId);
    if (targets.length === 0) {
      // Fall back to all tools if none detected
      targets = KNOWN_TOOL_IDS;
    }
  }

  // Nothing to sync
  if (mcpCount === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: doWrite ? 'applied' : 'plan', tools: [] });
      return 0;
    }
    writeLine(io.stdout, style.dim('Nothing to sync: manifest has no MCP servers.'));
    writeLine(io.stdout, style.dim('Run `agora freeze --write` to populate the manifest first.'));
    return 0;
  }

  if (doWrite && doYes) {
    // Apply mode
    let results: ToolSyncPlan[];
    try {
      results = applySync(manifest, env, targets, scope, prune);
    } catch (e) {
      return usageError(io, `Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: 'applied', tools: results });
      return 0;
    }

    writeLine(io.stdout, style.accent('agora sync — applied'));
    writeLine(io.stdout);
    writeLine(io.stdout, formatPlan(results, style));
    writeLine(io.stdout);

    const filesWritten = results
      .filter((p) => p.location !== null)
      .filter(
        (p) =>
          p.change.added.length > 0 || p.change.updated.length > 0 || p.change.removed.length > 0
      )
      .map((p) => p.location!.path);

    if (filesWritten.length > 0) {
      writeLine(io.stdout, 'Files written:');
      for (const f of filesWritten) {
        writeLine(io.stdout, `  ${f}`);
      }
    } else {
      writeLine(io.stdout, style.dim('No files changed.'));
    }
  } else {
    // Dry-run mode (default)
    const plans = planSync(manifest, env, targets, scope, prune);

    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: 'plan', tools: plans });
      return 0;
    }

    writeLine(io.stdout, style.accent('agora sync — dry run'));
    writeLine(io.stdout);
    writeLine(io.stdout, formatPlan(plans, style));
    writeLine(io.stdout);
    writeLine(
      io.stdout,
      style.dim('No files written. Run with --write --yes to apply these changes.')
    );
    if (prune) {
      writeLine(io.stdout, style.dim('(--prune is active: unmanaged servers will be removed)'));
    }
  }

  return 0;
};
