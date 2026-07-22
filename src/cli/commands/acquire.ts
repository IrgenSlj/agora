import { type AcquireResult, acquire, renderAcquireResult } from '../../acquire.js';
import type { SourceId } from '../../federation/types.js';
import type { AgentToolId } from '../../stack/types.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

const AGENT_TOOLS = new Set<AgentToolId>(['opencode', 'claude-code', 'cursor', 'windsurf']);
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
    githubToken: io.env?.AGORA_GITHUB_TOKEN
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
  } else {
    writeLine(io.stdout, renderAcquireResult(result));
  }

  return acquireExitCode(result);
};
