import { acquire, renderAcquireResult } from '../../acquire.js';
import type { AgentToolId } from '../../stack/types.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

const AGENT_TOOLS = new Set<AgentToolId>(['opencode', 'claude-code', 'cursor', 'windsurf']);

function toolFlag(value: string | undefined): AgentToolId | undefined {
  if (!value) return undefined;
  return AGENT_TOOLS.has(value as AgentToolId) ? (value as AgentToolId) : undefined;
}

export const commandAcquire: CommandHandler = async (parsed, io) => {
  const query = parsed.args.join(' ').trim();
  if (!query) return usageError(io, 'acquire requires an item id or capability query');

  const rawTool = stringFlag(parsed, 'tool');
  const tool = toolFlag(rawTool);
  if (rawTool && !tool) {
    return usageError(io, `unsupported tool "${rawTool}"`);
  }

  const result = await acquire({
    query,
    tool,
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

  return result.status === 'installed' || result.status === 'dry_run' ? 0 : 1;
};
