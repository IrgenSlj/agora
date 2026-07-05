import { ALL_ADAPTERS, getAdapter, detectTools } from '../../stack/registry.js';
import type { AgentToolId, DesiredServer, StackEnv, SyncChange } from '../../stack/types.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError } from '../helpers.js';
import { cliTheme } from '../theme.js';

/**
 * `agora integrate [harness|--all]` (brief P6 deliverable 1) — Agora installs
 * *itself* into each harness using that harness's own `ToolAdapter.writeServers`
 * machinery: the first thing the stack manager manages is Agora. Registers one
 * `agora` MCP server entry with the zero-install npx launcher
 * (`npx -y agora-hub mcp`) — surgical/atomic, preserving everything else in the
 * harness's config exactly as `agora sync` already does.
 *
 * Defaults to user scope (unlike sync/plan/apply, which default to project):
 * the point of `integrate` is that Agora's tools are available to that harness
 * everywhere, not just in one project directory (brief §7 acceptance demo 5).
 */

const KNOWN_TOOL_IDS: AgentToolId[] = ALL_ADAPTERS.map((a) => a.id);

const AGORA_SERVER_NAME = 'agora';
const AGORA_LAUNCHER: DesiredServer = {
  name: AGORA_SERVER_NAME,
  command: ['npx', '-y', 'agora-hub', 'mcp'],
  enabled: true
};

type IntegrateStatus = 'written' | 'planned' | 'skipped' | 'error';

interface IntegrateEntry {
  tool: AgentToolId;
  displayName: string;
  location: string | null;
  status: IntegrateStatus;
  change?: SyncChange;
  reason?: string;
}

function planEntry(toolId: AgentToolId, env: StackEnv, scope: 'project' | 'user'): IntegrateEntry {
  const adapter = getAdapter(toolId)!;
  const location = adapter.writeLocation(env, scope);
  if (!location) {
    return {
      tool: toolId,
      displayName: adapter.displayName,
      location: null,
      status: 'skipped',
      reason: `${adapter.displayName} has no ${scope} config location`
    };
  }

  const existing = adapter
    .readServers(env)
    .find((s) => s.name === AGORA_SERVER_NAME && s.scope === scope);

  return {
    tool: toolId,
    displayName: adapter.displayName,
    location: location.path,
    status: 'planned',
    change: existing
      ? { added: [], updated: [AGORA_SERVER_NAME], removed: [] }
      : { added: [AGORA_SERVER_NAME], updated: [], removed: [] }
  };
}

function writeEntry(toolId: AgentToolId, env: StackEnv, scope: 'project' | 'user'): IntegrateEntry {
  const adapter = getAdapter(toolId)!;
  const location = adapter.writeLocation(env, scope);
  if (!location) {
    return {
      tool: toolId,
      displayName: adapter.displayName,
      location: null,
      status: 'skipped',
      reason: `${adapter.displayName} has no ${scope} config location`
    };
  }

  try {
    const change = adapter.writeServers(location, [AGORA_LAUNCHER], { prune: false });
    return {
      tool: toolId,
      displayName: adapter.displayName,
      location: location.path,
      status: 'written',
      change
    };
  } catch (e) {
    return {
      tool: toolId,
      displayName: adapter.displayName,
      location: location.path,
      status: 'error',
      reason: e instanceof Error ? e.message : String(e)
    };
  }
}

function renderEntries(
  entries: IntegrateEntry[],
  dryRun: boolean,
  theme: ReturnType<typeof cliTheme>
): string {
  const lines: string[] = [theme.accent(dryRun ? 'agora integrate — plan' : 'agora integrate')];
  for (const entry of entries) {
    const locationLabel = entry.location ?? '(no location)';
    lines.push(`  ${entry.displayName}  →  ${locationLabel}`);
    switch (entry.status) {
      case 'written':
        lines.push(
          `    ${entry.change!.added.length > 0 ? '+ agora (added)' : '~ agora (updated)'}`
        );
        break;
      case 'planned':
        lines.push(
          `    ${entry.change!.added.length > 0 ? '+ agora (would add)' : '~ agora (would update)'}`
        );
        break;
      case 'skipped':
        lines.push(`    ${theme.dim(`skipped: ${entry.reason}`)}`);
        break;
      case 'error':
        lines.push(`    ${theme.error(`error: ${entry.reason}`)}`);
        break;
    }
  }
  return lines.join('\n');
}

export const commandIntegrate: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const env: StackEnv = { cwd: io.cwd, home: io.env?.HOME, env: io.env };

  const all = Boolean(parsed.flags.all);
  const harnessArg = parsed.args[0];

  if (all && harnessArg) {
    return usageError(io, 'Specify either a harness id or --all, not both.');
  }
  if (!all && !harnessArg) {
    return usageError(
      io,
      `agora integrate requires a harness id or --all. Valid harnesses: ${KNOWN_TOOL_IDS.join(', ')}`
    );
  }
  if (harnessArg && !KNOWN_TOOL_IDS.includes(harnessArg as AgentToolId)) {
    return usageError(
      io,
      `Unknown harness: ${harnessArg}. Valid values: ${KNOWN_TOOL_IDS.join(', ')}`
    );
  }

  const scopeFlag = stringFlag(parsed, 'scope');
  if (scopeFlag !== undefined && scopeFlag !== 'project' && scopeFlag !== 'user') {
    return usageError(io, `Invalid scope: ${scopeFlag}. Must be "project" or "user".`);
  }
  // Unlike sync/plan/apply, integrate defaults to USER scope: the point is
  // that agora's tools become available to a harness everywhere, not just in
  // the current project (brief §7 demo 5: "on a fresh machine").
  const scope: 'project' | 'user' = scopeFlag === 'project' ? 'project' : 'user';

  let targets: AgentToolId[];
  if (all) {
    const detected = detectTools(env);
    targets = detected.filter((t) => t.present).map((t) => t.adapter.id as AgentToolId);
    // A genuinely fresh machine has nothing detected yet — --all still means
    // "every harness Agora knows how to integrate with" (demo 5), so fall
    // back to the full adapter list rather than reporting zero targets.
    if (targets.length === 0) targets = KNOWN_TOOL_IDS;
  } else {
    targets = [harnessArg as AgentToolId];
  }

  const dryRun = Boolean(parsed.flags.dryRun);
  const entries = targets.map((toolId) =>
    dryRun ? planEntry(toolId, env, scope) : writeEntry(toolId, env, scope)
  );

  const hasError = entries.some((e) => e.status === 'error');

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      mode: dryRun ? 'plan' : 'integrated',
      scope,
      command: AGORA_LAUNCHER.command,
      targets: entries
    });
    return hasError ? 1 : 0;
  }

  writeLine(io.stdout, renderEntries(entries, dryRun, theme));
  writeLine(io.stdout, '');
  writeLine(
    io.stdout,
    theme.muted(
      dryRun
        ? 'Dry run — nothing written. Re-run without --dry-run to apply.'
        : 'Restart each harness (or start a new session) so the agora MCP server is loaded.'
    )
  );

  return hasError ? 1 : 0;
};
