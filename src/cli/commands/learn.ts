// `agora learn`: propose a minimal agora.cedar from recorded sessions.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { sessionsForRepo } from '../../log/select.js';
import { lintPolicyText, POLICY_FILE } from '../../policy/engine.js';
import { applyBlock, learnPolicy, lineDiff } from '../../policy/learn.js';
import { repoRoot } from '../../receipt/git.js';
import { headerLine, rule, section, status, tally } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandLearn: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();
  const root = repoRoot(cwd) ?? cwd;
  const path = join(root, POLICY_FILE);
  const dataDir = detectDataDir(parsed, io);
  const session = stringFlag(parsed, 'session');

  const { verified, invalid } = sessionsForRepo(dataDir, {
    repo: root,
    all: parsed.flags.all === true,
    ...(session ? { session } : {})
  });
  if (invalid.length) {
    writeLine(
      io.stderr,
      `Ignored ${invalid.length} session(s) whose log does not verify: ${invalid.join(', ')}`
    );
  }
  if (!verified.length) {
    if (parsed.flags.json) writeJson(io.stdout, { sessions: 0, proposal: null });
    else
      writeLine(
        io.stdout,
        theme.muted(
          'No recorded sessions for this repository yet. Run `agora hook install`, then work as usual.'
        )
      );
    return ExitCode.OK;
  }

  const { block, rules } = learnPolicy(verified);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  const proposed = applyBlock(current, block);
  const lint = await lintPolicyText(proposed);
  if (!lint.ok) {
    // A learned policy that does not validate is a bug in learn, never something to write.
    writeLine(io.stderr, 'The learned policy does not validate; nothing written:');
    for (const p of [...lint.errors, ...lint.schemaViolations]) writeLine(io.stderr, `  ${p}`);
    return ExitCode.COULD_NOT_CHECK;
  }
  const changed = proposed !== current;

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      sessions: verified.length,
      rules,
      changed,
      applied: Boolean(parsed.flags.apply && changed),
      proposal: proposed
    });
  } else {
    const out = (l = '') => writeLine(io.stdout, l);
    const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    out('');
    out(
      headerLine(
        'learn',
        `${n(verified.length, 'session')} ${theme.glyph('arrow')} ${n(rules, 'rule')}`,
        theme
      )
    );
    out('');
    if (!changed) {
      out(`  ${status('success', `${POLICY_FILE} already matches what agents did`, theme)}`);
      out('');
      return ExitCode.OK;
    }
    const diff = lineDiff(current ?? '', proposed);
    const added = diff.filter((l) => l.startsWith('+ '));
    const removed = diff.filter((l) => l.startsWith('- '));
    out(section('Proposed rules', theme, `+${added.length}  -${removed.length}`));
    for (const line of diff) {
      if (line.startsWith('+ ')) out(`  ${theme.success('+')} ${line.slice(2)}`);
      else if (line.startsWith('- ')) out(`  ${theme.error('-')} ${line.slice(2)}`);
    }
    out('');
    out(rule(theme));
    out(
      tally(
        [
          [added.length, 'lines added'],
          [removed.length, 'removed']
        ],
        theme
      )
    );
  }

  if (parsed.flags.apply && changed) {
    atomicWriteFile(path, proposed, 0o644);
    if (!parsed.flags.json) {
      writeLine(
        io.stdout,
        `  ${status('success', `wrote ${POLICY_FILE}`, theme)}  ${theme.muted('next')}  agora replay\n`
      );
    }
  } else if (!parsed.flags.json && changed) {
    writeLine(io.stdout, `  ${theme.muted('nothing written. to apply')}  agora learn --apply\n`);
  }
  return ExitCode.OK;
};
