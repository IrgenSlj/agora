import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * OpenCode plugins can only register *tools* — they cannot register slash
 * commands. To get a real `/agora` slash command we ship this markdown command
 * file, which OpenCode loads from `.opencode/command/agora.md`. Its body is a
 * prompt template: whatever the user types after `/agora` lands in
 * `$ARGUMENTS`, and the model routes it to the matching `agora_*` tool.
 */
export const AGORA_COMMAND_TEMPLATE = [
  '---',
  'description: Search, browse, and install from the Agora marketplace',
  '---',
  '',
  'You are operating the Agora marketplace plugin. The user invoked `/agora` with:',
  '',
  '$ARGUMENTS',
  '',
  'Route the request to the matching Agora tool and return its output:',
  '',
  '- `agora_search` — search packages, workflows, and prompts (`search <query>`)',
  '- `agora_browse_category` — browse a category: mcp, prompt, workflow, all',
  '- `agora_trending` — trending packages and workflows',
  '- `agora_browse` — full details for one package or workflow by id (`browse <id>`)',
  '- `agora_install` — install steps/config for a package or workflow (`install <id>`)',
  '- `agora_tutorial` — interactive AI/MCP tutorials (`tutorial <id> [step]`)',
  '- `agora_info` — plugin help and the command list',
  '',
  'Community features (reviews, discussions, profiles, publishing) and AI chat',
  'are available in the `agora` CLI, not as plugin tools.',
  '',
  'If `$ARGUMENTS` is empty, call `agora_info`. Otherwise treat the first word as',
  'the sub-command and pass the rest through as tool arguments.'
].join('\n');

/**
 * Writes the `/agora` slash command into a project's `.opencode/command/`
 * directory. Returns the path written.
 */
export function installAgoraCommand(cwd: string): string {
  const commandDir = join(cwd, '.opencode', 'command');
  mkdirSync(commandDir, { recursive: true });
  const commandPath = join(commandDir, 'agora.md');
  writeFileSync(commandPath, AGORA_COMMAND_TEMPLATE, 'utf8');
  return commandPath;
}
