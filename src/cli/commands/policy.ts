// `agora policy`: scaffold and lint agora.cedar.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { lintPolicyText, POLICY_FILE } from '../../policy/engine.js';
import { repoRoot } from '../../receipt/git.js';
import { ExitCode } from '../exit-codes.js';
import { usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export { POLICY_FILE };

const SCAFFOLD = `// agora.cedar: what coding agents may do in this repository.
//
// With this file present, anything no rule permits is denied. Agora's shipped
// baseline is always added on top and only forbids (revoked MCP servers).
//
// Start from what agents actually do here:  agora learn --apply
// Check what a change would have blocked:  agora replay
//
// Actions and resources (see \`agora help policy\`):
//   read, write   File    { path: "src/app.ts" | "class:home" | ..., class: "repo" | "home" | "tmp" | "system" | "other" }
//   exec          Program { name: "git" }
//   connect       Peer    { host: "api.github.com", port: 443 }
//   call          Tool    { name, server, mcp, revoked? }
//
// Until you replace it, this rule permits everything: the file is a placeholder.
@id("placeholder-permit-all")
permit (principal, action, resource);
`;

export const commandPolicy: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0];
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();
  const root = repoRoot(cwd) ?? cwd;
  const path = join(root, POLICY_FILE);

  if (sub === 'init') {
    if (existsSync(path))
      return usageError(io, `${relative(cwd, path) || POLICY_FILE} already exists.`);
    atomicWriteFile(path, SCAFFOLD, 0o644);
    writeLine(io.stdout, `Created ${theme.accent(relative(cwd, path) || POLICY_FILE)}.`);
    writeLine(
      io.stdout,
      theme.dim('It permits everything until you run `agora learn --apply` or edit it.')
    );
    return ExitCode.OK;
  }

  if (sub === 'check') {
    if (!existsSync(path)) {
      if (parsed.flags.json) writeJson(io.stdout, { policy: null });
      else
        writeLine(
          io.stdout,
          theme.muted(`No ${POLICY_FILE}: agents are limited only by the baseline.`)
        );
      return ExitCode.OK;
    }
    const lint = await lintPolicyText(readFileSync(path, 'utf8'));
    if (parsed.flags.json) {
      writeJson(io.stdout, { policy: POLICY_FILE, ...lint });
    } else if (lint.ok) {
      writeLine(
        io.stdout,
        `${theme.success('✓')} ${POLICY_FILE} is valid against the agent-action schema.`
      );
    } else {
      writeLine(io.stdout, `${theme.error('✗')} ${POLICY_FILE}`);
      for (const p of [...lint.errors, ...lint.schemaViolations])
        writeLine(io.stdout, theme.dim(`    ${p}`));
    }
    return lint.ok ? ExitCode.OK : ExitCode.POLICY_FORBID;
  }

  writeLine(io.stdout, 'Usage: agora policy <init|check> [--json]');
  writeLine(io.stdout, '');
  writeLine(io.stdout, `  init   scaffold ${POLICY_FILE} at the repository root`);
  writeLine(io.stdout, `  check  validate ${POLICY_FILE} against the agent-action schema`);
  return sub ? usageError(io, `Unknown policy subcommand: ${sub}`) : ExitCode.USAGE;
};
