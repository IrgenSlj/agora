// `agora canary`: plant, inspect or remove the decoy credential file.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CANARY_FILE,
  installCanary,
  readCanaries,
  removeCanary
} from '../../canary/canary.js';
import { DECOY_SERVER, DECOY_TOOL, serveDecoy } from '../../canary/tool.js';
import { repoRoot } from '../../receipt/git.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const SAFE_FILE = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

export const commandCanary: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'status';
  const theme = cliTheme(style, io);
  // The decoy MCP server: started by the agent host, wherever it runs.
  if (sub === 'serve') {
    await serveDecoy();
    return ExitCode.OK;
  }
  const root = repoRoot(io.cwd ?? process.cwd());
  if (!root) return usageError(io, 'agora canary works inside a git repository.');
  const json = Boolean(parsed.flags.json);

  if (sub === 'install') {
    const file = stringFlag(parsed, 'file') ?? DEFAULT_CANARY_FILE;
    if (!SAFE_FILE.test(file))
      return usageError(io, '--file must be a plain path inside the repository.');
    const tool = Boolean(parsed.flags.tool);
    let r: ReturnType<typeof installCanary>;
    try {
      r = installCanary(root, file, { tool, home: io.env?.HOME });
    } catch (e) {
      writeLine(
        io.stderr,
        `Could not register the decoy tool: ${e instanceof Error ? e.message : String(e)}`
      );
      return ExitCode.COULD_NOT_CHECK;
    }
    if (json) {
      writeJson(io.stdout, r);
      return ExitCode.OK;
    }
    if (r.status === 'exists') {
      const mine = readCanaries(root).file === r.file;
      if (!mine) return usageError(io, `${r.file} already exists; choose another with --file.`);
      writeLine(io.stdout, status('info', `canary already planted: ${r.file}`, theme));
      return ExitCode.OK;
    }
    writeLine(io.stdout, status('success', `canary planted: ${r.file}`, theme));
    writeLine(
      io.stdout,
      theme.dim(
        '  Fake credentials, hidden from git by .git/info/exclude, so never committed.\n' +
          '  Any agent tool call that reads or writes it, or a shell command that names it, is\n' +
          '  denied and recorded; `agora ci` fails a commit whose receipt counts a hit.\n' +
          '  Not seen: a program that opens it without naming it (a script, `cat .env*`).'
      )
    );
    if (readCanaries(root).tool)
      writeLine(
        io.stdout,
        theme.dim(
          `  Decoy tool ${DECOY_SERVER}/${DECOY_TOOL}: registered for you in ~/.claude.json\n` +
            '  (local scope, this repository only), and offered by the OpenCode plugin after\n' +
            '  `agora apply`. Restart the agent to see it. Any call is denied and recorded.'
        )
      );
    return ExitCode.OK;
  }

  if (sub === 'remove') {
    const file = removeCanary(root, io.env?.HOME);
    if (json) writeJson(io.stdout, { removed: file ?? null });
    else
      writeLine(
        io.stdout,
        file
          ? status('success', `canary removed: ${file}`, theme)
          : status('info', 'no canary planted here', theme)
      );
    return ExitCode.OK;
  }

  if (sub === 'status') {
    const state = readCanaries(root);
    const present = Boolean(state.file && existsSync(join(root, state.file)));
    if (json) {
      writeJson(io.stdout, {
        file: state.file ?? null,
        present,
        installed: state.installed ?? null
      });
      return ExitCode.OK;
    }
    if (!state.file)
      writeLine(io.stdout, status('info', 'no canary planted · run `agora canary install`', theme));
    else if (!present)
      writeLine(
        io.stdout,
        status('warning', `canary ${state.file} is recorded but missing`, theme)
      );
    else writeLine(io.stdout, status('success', `canary planted: ${state.file}`, theme));
    return ExitCode.OK;
  }

  return usageError(
    io,
    'Usage: agora canary [status|install|remove] [--file <path>] [--tool] [--json]'
  );
};
