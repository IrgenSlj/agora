// `agora replay`: run recorded sessions against a policy and report what it
// would have denied, before anything is enforced.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sessionsForRepo } from '../../log/select.js';
import { loadPolicySet, POLICY_FILE } from '../../policy/engine.js';
import { revocationFacts } from '../../policy/facts.js';
import { replay } from '../../policy/replay.js';
import { repoRoot } from '../../receipt/git.js';
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
    writeLine(
      io.stdout,
      `${result.evaluated} actions across ${n} session${n === 1 ? '' : 's'} replayed against ${policyArg ?? POLICY_FILE}.`
    );
    if (!result.denied) {
      writeLine(io.stdout, `${theme.success('✓')} nothing would have been denied.`);
    } else {
      writeLine(io.stdout, `${theme.error('✗')} ${result.denied} would have been denied:`);
      for (const g of result.groups.slice(0, 50)) {
        const why = g.reasons.length ? `by ${g.reasons.join(', ')}` : 'no rule permits it';
        writeLine(
          io.stdout,
          `    ${g.action.padEnd(7)} ${g.subject}  ${theme.dim(`${g.count}× in ${g.sessions} session${g.sessions === 1 ? '' : 's'} · ${why}`)}`
        );
      }
      if (result.groups.length > 50)
        writeLine(io.stdout, theme.dim(`    … ${result.groups.length - 50} more`));
    }
    if (result.inconclusive) {
      writeLine(
        io.stdout,
        theme.warning(
          `${result.inconclusive} decision(s) were reached with a rule skipped on error; run \`agora policy check\`.`
        )
      );
    }
  }
  return result.denied || result.inconclusive ? ExitCode.POLICY_FORBID : ExitCode.OK;
};
