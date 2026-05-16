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
  'Route `$ARGUMENTS`: first word → call `agora_<word>` with rest as args. Empty → `agora_info`.'
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
