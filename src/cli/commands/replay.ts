// `agora replay`: run recorded sessions against a policy and report what it
// would have denied, before anything is enforced.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionsForRepo } from '../../log/select.js';
import { loadPolicySet, POLICY_FILE } from '../../policy/engine.js';
import { revocationFacts } from '../../policy/facts.js';
import { replay } from '../../policy/replay.js';
import { repoRoot } from '../../receipt/git.js';
import { headerLine, leader, MEASURE, rule, section, status, tally } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandReplay: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();
  const root = repoRoot(cwd) ?? cwd;
  const dataDir = detectDataDir(parsed, io);

  const policyArg = stringFlag(parsed, 'policy');
  const policyPath = resolve(cwd, policyArg ?? `${root}/${POLICY_FILE}`);
  if (!existsSync(policyPath)) {
    return usageError(
      io,
      `No policy to replay: ${policyArg ?? POLICY_FILE} does not exist. Pass --policy <file>.`
    );
  }
  const set = await loadPolicySet({
    policyText: readFileSync(policyPath, 'utf8'),
    source: policyArg ?? POLICY_FILE
  });
  if (!set) {
    writeLine(io.stderr, 'The Cedar engine could not be loaded.');
    return ExitCode.COULD_NOT_CHECK;
  }
  if (set.errors.length) {
    writeLine(io.stderr, 'The policy does not parse:');
    for (const e of set.errors) writeLine(io.stderr, `  ${e}`);
    return ExitCode.USAGE;
  }

  const sessionFlag = stringFlag(parsed, 'session');
  const sessions = sessionsForRepo(dataDir, {
    repo: root,
    all: parsed.flags.all === true,
    ...(sessionFlag ? { session: sessionFlag } : {})
  });
  if (sessions.invalid.length) {
    writeLine(
      io.stderr,
      `Skipped ${sessions.invalid.length} session(s) whose log does not verify: ${sessions.invalid.join(', ')}`
    );
  }
  if (!sessions.verified.length) {
    if (parsed.flags.json) writeJson(io.stdout, { sessions: 0, result: null });
    else writeLine(io.stdout, theme.muted('No recorded sessions to replay for this repository.'));
    return ExitCode.OK;
  }

  const facts = revocationFacts({ cwd: root, home: io.env?.HOME, env: io.env, dataDir });
  const result = await replay(set, sessions.verified, facts);

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      policy: policyArg ?? POLICY_FILE,
      sessions: sessions.verified.length,
      ...result
    });
  } else {
    const n = sessions.verified.length;
    const out = (l = '') => writeLine(io.stdout, l);
    const plural = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`;
    out('');
    out(
      headerLine(
        'replay',
        `${policyArg ?? POLICY_FILE} ${theme.glyph('arrow')} ${plural(n, 'session')}`,
        theme
      )
    );
    out('');
    if (!result.denied) {
      out(`  ${status('success', 'nothing would have been denied', theme)}`);
    } else {
      out(section('Would have been denied', theme, String(result.denied)));
      for (const g of result.groups.slice(0, 50)) {
        const why = g.reasons.length ? `by ${g.reasons.join(', ')}` : 'no rule permits it';
        out(
          `  ${theme.error(theme.glyph('denied'))} ${leader(`${g.action} ${g.subject}`, theme.muted(`${g.count}× · ${plural(g.sessions, 'session')}`), theme, MEASURE - 2)}`
        );
        out(`    ${theme.muted(why)}`);
      }
      if (result.groups.length > 50) out(`  ${theme.muted(`… ${result.groups.length - 50} more`)}`);
    }
    if (result.inconclusive)
      out(
        `  ${status('unknown', `${plural(result.inconclusive, 'decision')} had a rule skipped on error · agora policy check`, theme)}`
      );
    out('');
    out(rule(theme));
    out(
      tally(
        [
          [result.evaluated, 'actions replayed'],
          [result.denied, 'denied'],
          [result.inconclusive, 'inconclusive']
        ],
        theme
      )
    );
    out('');
  }
  return result.denied || result.inconclusive ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
