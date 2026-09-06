import { type AcquireResult, acquire, renderAcquireResult } from '../../acquire.js';
import { createProvenanceResolver } from '../../evidence/resolve-provenance.js';
import type { SourceId } from '../../federation/types.js';
import { manifestPath, readManifest } from '../../stack/manifest.js';
import { ALL_ADAPTERS } from '../../stack/registry.js';
import type { AgentToolId } from '../../stack/types.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

// Derived, not listed. This was a hand-written literal that silently fell a
// host behind the adapter registry: adding VS Code left `agora acquire --tool
// vscode` rejecting a host every other command already supported, and the
// compiler could not see it because a Set<AgentToolId> accepts a subset of the
// union quite happily.
const AGENT_TOOLS = new Set<AgentToolId>(ALL_ADAPTERS.map((a) => a.id));
const SOURCE_IDS = new Set<SourceId>([
  'official',
  'glama',
  'pulsemcp',
  'skills-github',
  'smithery',
  'github',
  'huggingface',
  'local'
]);

function toolFlag(value: string | undefined): AgentToolId | undefined {
  if (!value) return undefined;
  return AGENT_TOOLS.has(value as AgentToolId) ? (value as AgentToolId) : undefined;
}

function sourceFlag(value: string | undefined): SourceId | undefined {
  if (!value) return undefined;
  return SOURCE_IDS.has(value as SourceId) ? (value as SourceId) : undefined;
}

/**
 * Exit codes (brief §9): 0 ok · 1 policy forbid (scan blocked) ·
 * 2 usage (needs confirmation, errors).
 * `dry_run` always exits 0 — it is a preview and never fails by design;
 * its `scan` field still carries the real verdict for `--json` consumers.
 */
function acquireExitCode(result: AcquireResult): number {
  switch (result.status) {
    case 'installed':
    case 'dry_run':
      return ExitCode.OK;
    case 'needs_confirmation':
      return ExitCode.USAGE;
    case 'blocked':
      return result.scan && result.scan.summary.fail > 0
        ? ExitCode.POLICY_FORBID
        : ExitCode.POLICY_FORBID;
    default:
      return ExitCode.POLICY_FORBID;
  }
}

export const commandAcquire: CommandHandler = async (parsed, io) => {
  const query = parsed.args.join(' ').trim();
  if (!query) return usageError(io, 'acquire requires an item id or capability query');

  const rawTool = stringFlag(parsed, 'tool');
  const tool = toolFlag(rawTool);
  if (rawTool && !tool) {
    return usageError(io, `unsupported tool "${rawTool}"`);
  }

  const rawSource = stringFlag(parsed, 'source');
  const source = sourceFlag(rawSource);
  if (rawSource && !source) {
    return usageError(io, `unsupported source "${rawSource}"`);
  }

  const result = await acquire({
    query,
    tool,
    source,
    configPath: stringFlag(parsed, 'config'),
    acceptWarnings: parsed.flags.acceptWarnings === true,
    save: parsed.flags.save === true,
    dryRun: parsed.flags.dryRun === true,
    cwd: io.cwd,
    env: io.env,
    dataDir: detectDataDir(parsed, io),
    fetcher: io.fetcher,
    githubToken: io.env?.AGORA_GITHUB_TOKEN,
    policyFiles: readManifest(manifestPath({ cwd: io.cwd, env: io.env }))?.policy?.files ?? [],
    // Wired here rather than inside acquire() so the library never reaches
    // Fulcio/Rekor on its own — callers and tests opt in.
    scanOptions: {
      provenance: createProvenanceResolver({
        fetcher: io.fetcher,
        offline: io.env?.AGORA_OFFLINE === '1'
      })
    }
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
  } else {
    writeLine(io.stdout, renderAcquireResult(result));
  }

  return acquireExitCode(result);
};
