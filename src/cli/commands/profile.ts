// `agora profile`: minimal policies per MCP server, added to agora.cedar.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { lintPolicyText, POLICY_FILE } from '../../policy/engine.js';
import { addProfile, listProfiles, SERVER_NAME } from '../../policy/profiles.js';
import { repoRoot } from '../../receipt/git.js';
import { section, status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandProfile: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0] ?? 'list';
  const theme = cliTheme(style, io);
  const profiles = listProfiles();

  if (sub === 'list') {
    if (parsed.flags.json) {
      writeJson(
        io.stdout,
        profiles.map(({ name, package: pkg, summary }) => ({ name, package: pkg ?? null, summary }))
      );
      return ExitCode.OK;
    }
    writeLine(io.stdout, section('Profiles', theme, String(profiles.length)).slice(2));
    for (const p of profiles) {
      writeLine(io.stdout, theme.accent(p.name));
      writeLine(
        io.stdout,
        `  ${theme.muted(`${p.package ?? ''} · ${p.summary.split(', ').at(-1) ?? ''}`)}`
      );
    }
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      theme.muted('add one  agora profile add <name> --server <name in your host config>')
    );
    return ExitCode.OK;
  }

  const name = parsed.args[1];
  const profile = profiles.find((p) => p.name === name);
  if (!name || !profile)
    return usageError(
      io,
      `No profile ${name ?? ''}. Run \`agora profile list\`.`.replace('  ', ' ')
    );

  if (sub === 'show') {
    if (parsed.flags.json) writeJson(io.stdout, profile);
    else writeLine(io.stdout, profile.text.trimEnd());
    return ExitCode.OK;
  }

  if (sub === 'add') {
    const server = stringFlag(parsed, 'server');
    if (!server || !SERVER_NAME.test(server))
      return usageError(io, '--server takes the name the server has in your host config.');
    const root = repoRoot(io.cwd ?? process.cwd());
    if (!root) return usageError(io, 'agora profile add works inside a git repository.');
    const path = join(root, POLICY_FILE);
    if (!existsSync(path))
      return usageError(
        io,
        `No ${POLICY_FILE} here. A profile alone would deny everything else; run \`agora learn --apply\` first.`
      );
    const next = addProfile(readFileSync(path, 'utf8'), profile, server);
    const lint = await lintPolicyText(next);
    if (!lint.ok) {
      writeLine(io.stderr, `The result would not be a valid ${POLICY_FILE}; nothing written:`);
      for (const e of [...lint.errors, ...lint.schemaViolations]) writeLine(io.stderr, `  ${e}`);
      return ExitCode.COULD_NOT_CHECK;
    }
    atomicWriteFile(path, next, 0o644);
    if (parsed.flags.json) writeJson(io.stdout, { profile: profile.name, server, written: path });
    else {
      writeLine(
        io.stdout,
        status('success', `added ${profile.name} for ${server} to ${POLICY_FILE}`, theme)
      );
      writeLine(
        io.stdout,
        theme.dim('  `agora replay` shows what it changes; `agora apply` compiles it.')
      );
    }
    return ExitCode.OK;
  }

  return usageError(io, 'Usage: agora profile [list | show <name> | add <name> --server <name>]');
};
