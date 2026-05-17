import { readFileSync } from 'node:fs';
import { COMMANDS, renderManual } from './commands-meta.js';
import { runInteractiveMenu } from './menu.js';
import { runTui } from './tui.js';
import { getMarketplaceItems, type MarketplaceItem } from '../marketplace.js';
import { createStyler, shouldUseColor, supportsTrueColor, type Styler } from '../ui.js';
import { usage, welcome } from './format.js';
import { parseArgs, type CliIo } from './flags.js';
import { writeLine, isInteractive } from './helpers.js';
import type { CommandMap } from './commands/types.js';
import * as marketplace from './commands/marketplace.js';
import * as community from './commands/community.js';
import * as learn from './commands/learn.js';
import * as chatModule from './commands/chat.js';
import * as initModule from './commands/init.js';
import * as operations from './commands/operations.js';
import * as exportModule from './commands/export.js';
import * as watchModule from './commands/watch.js';
import * as notifyModule from './commands/notify.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const AGORA_VERSION = pkg.version;
const VERSION = AGORA_VERSION;

// Active terminal styler. Reassigned once per `runCli` invocation from the
// caller's stream + env; defaults to plain so any direct formatter use is safe.
let style: Styler = createStyler(false);

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs(argv);
  const env = io.env ?? {};
  const useColor = shouldUseColor(
    io.stdout as { isTTY?: boolean },
    env,
    Boolean(parsed.flags.json)
  );
  style = createStyler(useColor, supportsTrueColor(env));

  if (parsed.flags.version) {
    writeLine(io.stdout, VERSION);
    return 0;
  }

  if (parsed.flags.help) {
    if (parsed.command && COMMANDS.some((c) => c.name === parsed.command)) {
      writeLine(io.stdout, commandManual(parsed.command));
    } else {
      writeLine(io.stdout, usage(style, VERSION));
    }
    return 0;
  }

  if (!parsed.command) {
    if (isInteractive(io, env)) {
      const { runShell } = await import('./shell.js');
      return runShell(io, style);
    }
    writeLine(io.stdout, welcome(useColor, supportsTrueColor(env), style, VERSION));
    return 0;
  }

  try {
    const cmd: CommandMap = {
      search: marketplace.commandSearch,
      browse: marketplace.commandBrowse,
      trending: marketplace.commandTrending,
      workflows: marketplace.commandWorkflows,
      similar: marketplace.commandSimilar,
      compare: marketplace.commandCompare,
      news: community.commandNews,
      community: community.commandCommunity,
      thread: community.commandThread,
      post: community.commandPost,
      reply: community.commandReply,
      vote: community.commandVote,
      flag: community.commandFlag,
      discussions: community.commandDiscussions,
      discuss: community.commandDiscuss,
      tutorials: learn.commandTutorials,
      tutorial: learn.commandTutorial,
      chat: chatModule.commandChat,
      init: initModule.commandInit,
      use: initModule.commandUse,
      install: operations.commandInstall,
      mcp: operations.commandMcp,
      save: operations.commandSave,
      saved: operations.commandSaved,
      remove: operations.commandRemove,
      publish: operations.commandPublish,
      review: operations.commandReview,
      reviews: operations.commandReviews,
      profile: operations.commandProfile,
      preferences: operations.commandPreferences,
      history: operations.commandHistory,
      config: operations.commandConfig,
      show: (p, io2, style2) =>
        operations.commandConfig({ ...p, args: ['show', ...p.args], command: 'config' }, io2, style2),
      edit: (p, io2, style2) =>
        operations.commandConfig({ ...p, args: ['edit', ...p.args], command: 'config' }, io2, style2),
      diff: (p, io2, style2) =>
        operations.commandConfig({ ...p, args: ['diff', ...p.args], command: 'config' }, io2, style2),
      export: exportModule.commandExport,
      watch: watchModule.commandWatch,
      notify: notifyModule.commandNotify,
      auth: operations.commandAuth,
      login: (p, io2, style2) =>
        operations.commandAuth({ ...p, args: ['login', ...p.args], command: 'auth' }, io2, style2),
      logout: (p, io2, style2) =>
        operations.commandAuth({ ...p, args: ['logout'], command: 'auth' }, io2, style2),
      whoami: (p, io2, style2) =>
        operations.commandAuth(
          { ...p, args: ['status'], command: 'auth', flags: { ...p.flags, json: true } },
          io2,
          style2
        )
    };

    const handler = cmd[parsed.command];
    if (handler) return await handler(parsed, io, style);

    if (parsed.command === 'help') {
      const helpTarget = parsed.args[0];
      if (helpTarget) {
        const meta = COMMANDS.find((c) => c.name === helpTarget);
        if (!meta) {
          writeLine(io.stderr, `Unknown command: ${helpTarget}`);
          writeLine(io.stderr, 'Run `agora help` for a list of commands.');
          return 1;
        }
        writeLine(io.stdout, commandManual(helpTarget));
      } else {
        writeLine(io.stdout, usage(style, VERSION));
      }
      return 0;
    }

    if (parsed.command === 'menu') return await runInteractiveMenu(io, style);
    if (parsed.command === 'tui') return await runTui(io, { initial: 'home' });
    if (parsed.command === 'completions') return await commandCompletions(parsed, io, style);
    if (parsed.command === 'shell') {
      const { runShell } = await import('./shell.js');
      return runShell(io, style);
    }

    writeLine(io.stderr, `Unknown command: ${parsed.command}`);
    writeLine(io.stderr, 'Run agora help for usage.');
    return 1;
  } catch (error) {
    writeLine(io.stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function commandManual(name: string): string {
  const meta = COMMANDS.find((c) => c.name === name);
  if (!meta) return '';
  return renderManual(meta, style);
}

export async function commandCompletions(
  parsed: { args: string[] },
  io: CliIo,
  _style: Styler
): Promise<number> {
  const shell = parsed.args[0] || 'bash';
  const { generateCompletions } = await import('./completions-gen.js');
  const output = generateCompletions(shell);
  if (output.startsWith('Unknown shell')) {
    writeLine(io.stderr, output);
    return 1;
  }
  writeLine(io.stdout, output);
  return 0;
}

export function listKnownItems(): MarketplaceItem[] {
  return getMarketplaceItems();
}
