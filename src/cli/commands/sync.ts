import { loadManifestFromSource, manifestPath, readManifest } from '../../stack/manifest.js';
import { ALL_ADAPTERS, detectTools } from '../../stack/registry.js';
import {
  applyInstructionsSync,
  applySync,
  findSyncDriftBlocks,
  gateManifestForSync,
  planInstructionsSync,
  planSync,
  type ToolSyncPlan
} from '../../stack/sync.js';
import type { AgentToolId, StackEnv } from '../../stack/types.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { Theme } from '../theme.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

function formatPlan(plan: ToolSyncPlan[], theme: Theme): string {
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

export const commandSync: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
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

  // --from <url|path>
  const fromFlag = stringFlag(parsed, 'from');

  // Read manifest
  let manifest;
  const isRemoteSource = fromFlag !== undefined && /^https?:\/\//i.test(fromFlag);

  if (fromFlag !== undefined) {
    try {
      manifest = await loadManifestFromSource(fromFlag, { cwd: io.cwd, fetcher: io.fetcher });
    } catch (e) {
      return usageError(io, e instanceof Error ? e.message : String(e));
    }
  } else {
    const mPath = manifestPath(env);
    const loaded = readManifest(mPath);
    if (loaded === null) {
      return usageError(
        io,
        `No agora.toml manifest found at ${mPath}. ` +
          'Run `agora freeze --write` to create one from your current stack.'
      );
    }
    manifest = loaded;
  }

  const mcpCount = Object.keys(manifest.mcp).length;
  const instructionsCount = Object.keys(manifest.instructions ?? {}).length;
  const dataDir = detectDataDir(parsed, io);
  const driftBlocks = findSyncDriftBlocks(manifest, dataDir);
  if (driftBlocks.length > 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: 'drift-blocked', blocked: driftBlocks });
      return ExitCode.POLICY_FORBID;
    }
    writeLine(io.stdout, theme.accent('agora sync — drift blocked'));
    writeLine(io.stdout);
    for (const block of driftBlocks) {
      writeLine(io.stdout, `  mcp "${block.name}":`);
      writeLine(io.stdout, `    ✗ Description drift — ${block.detail}`);
    }
    writeLine(io.stdout);
    writeLine(
      io.stdout,
      theme.muted('Nothing written. Run `agora doctor --probe` to refresh or inspect quarantine.')
    );
    return ExitCode.POLICY_FORBID;
  }

  // --from: run the trust gate (the SAME exported scanItem gate from src/scan.ts —
  // never reimplemented here) over every mcp/instruction entry before anything
  // is written. A hard fail blocks the whole sync — the flagship demo.
  if (fromFlag !== undefined) {
    const gate = await gateManifestForSync(manifest, {
      fetcher: io.fetcher,
      cwd: io.cwd,
      baseSource: isRemoteSource ? fromFlag : undefined
    });
    if (!gate.ok) {
      if (parsed.flags.json) {
        writeJson(io.stdout, { mode: 'gate-blocked', blocked: gate.blocked });
        return ExitCode.POLICY_FORBID;
      }
      writeLine(io.stdout, theme.accent('agora sync — scan gate blocked'));
      writeLine(io.stdout);
      for (const entry of gate.blocked) {
        writeLine(io.stdout, `  ${entry.kind} "${entry.name}":`);
        for (const check of entry.scan.checks.filter((c) => c.status === 'fail')) {
          writeLine(io.stdout, `    ✗ ${check.label} — ${check.message}`);
        }
      }
      writeLine(io.stdout);
      writeLine(io.stdout, theme.muted('Nothing written. Fix the flagged entries and re-run.'));
      return ExitCode.POLICY_FORBID;
    }
  }

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
  if (mcpCount === 0 && instructionsCount === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: doWrite ? 'applied' : 'plan', tools: [], instructions: [] });
      return 0;
    }
    writeLine(
      io.stdout,
      theme.muted('Nothing to sync: manifest has no MCP servers or instructions.')
    );
    writeLine(io.stdout, theme.muted('Run `agora freeze --write` to populate the manifest first.'));
    return 0;
  }

  if (doWrite && doYes) {
    // Apply mode
    let results: ToolSyncPlan[];
    let instructionResults: ToolSyncPlan[];
    try {
      results = applySync(manifest, env, targets, scope, prune);
      instructionResults = await applyInstructionsSync(manifest, env, targets, scope, prune, {
        fetcher: io.fetcher,
        baseSource: isRemoteSource ? fromFlag : undefined
      });
    } catch (e) {
      return usageError(io, `Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: 'applied', tools: results, instructions: instructionResults });
      return 0;
    }

    writeLine(io.stdout, theme.accent('agora sync — applied'));
    writeLine(io.stdout);
    writeLine(io.stdout, formatPlan(results, theme));
    writeLine(io.stdout);
    writeLine(io.stdout, theme.accent('Instructions:'));
    writeLine(io.stdout, formatPlan(instructionResults, theme));
    writeLine(io.stdout);

    const filesWritten = [...results, ...instructionResults]
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
      writeLine(io.stdout, theme.muted('No files changed.'));
    }
  } else {
    // Dry-run mode (default)
    const plans = planSync(manifest, env, targets, scope, prune);
    const instructionPlans = await planInstructionsSync(manifest, env, targets, scope, prune, {
      fetcher: io.fetcher,
      baseSource: isRemoteSource ? fromFlag : undefined
    });

    if (parsed.flags.json) {
      writeJson(io.stdout, { mode: 'plan', tools: plans, instructions: instructionPlans });
      return 0;
    }

    writeLine(io.stdout, theme.accent('agora sync — dry run'));
    writeLine(io.stdout);
    if (isRemoteSource) {
      writeLine(
        io.stdout,
        theme.muted(
          'Manifest fetched from a remote source — review the servers below before applying.'
        )
      );
      writeLine(io.stdout);
    }
    writeLine(io.stdout, formatPlan(plans, theme));
    writeLine(io.stdout);
    writeLine(io.stdout, theme.accent('Instructions:'));
    writeLine(io.stdout, formatPlan(instructionPlans, theme));
    writeLine(io.stdout);
    writeLine(
      io.stdout,
      theme.muted('No files written. Run with --write --yes to apply these changes.')
    );
    if (prune) {
      writeLine(io.stdout, theme.muted('(--prune is active: unmanaged servers will be removed)'));
    }
  }

  return 0;
};
