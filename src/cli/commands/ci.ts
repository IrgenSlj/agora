// `agora ci` — the whole post-install question, once, with an exit code.
//
// This is the command the product is for. Every other surface asks a person to
// remember to ask; this one is wired into something that already runs on every
// push and does not get bored. The three checks it composes each exist as their
// own command (`audit`, `lock verify`, `doctor --strict`); what did not exist
// was one verdict, and chaining three commands in a workflow means three exit
// codes to reconcile and three chances to get the reconciliation wrong.
//
// Read-only by construction: it queries OSV, hashes what is on disk, and reads
// host configs. It starts no servers — see `healthCheck` — because a CI runner
// executing a stranger's configured processes on a pull request is a worse
// outcome than any check this command could offer.

import { writeFileSync } from 'node:fs';
import { annotationsFor, isGithubActions, writeJobSummary } from '../../ci/github.js';
import { type CiCheck, runCiChecks } from '../../ci/report.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import { verifyLockfileForCi } from './lock.js';
import type { CommandHandler } from './types.js';

const QUESTION: Record<CiCheck['name'], string> = {
  advisories: 'known-vulnerable',
  drift: 'changed since approval',
  health: 'stack coherent'
};

export const commandCi: CommandHandler = async (parsed, io, style) => {
  const failOnUnknown =
    parsed.flags.failOnUnknown === true || parsed.flags['fail-on-unknown'] === true;

  const report = await runCiChecks(io, {
    failOnUnknown,
    lockVerify: (cliIo) => verifyLockfileForCi(cliIo)
  });

  // `--json-file` exists so one run can serve both consumers. Annotations are
  // workflow commands on stdout, so redirecting stdout to capture the report
  // would swallow them; running the command twice instead would double every
  // OSV lookup and let the two runs disagree. Writing the machine report to a
  // path keeps stdout for the humans and the annotations, on one network pass.
  const jsonFile = stringFlag(parsed, 'jsonFile') || stringFlag(parsed, 'json-file');
  if (jsonFile) {
    try {
      writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (e) {
      writeLine(
        io.stderr,
        `Could not write ${jsonFile}: ${e instanceof Error ? e.message : String(e)}`
      );
      return ExitCode.USAGE;
    }
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, report);
  } else {
    const theme = cliTheme(style, io);
    const glyph = (c: CiCheck) =>
      c.state === 'pass'
        ? theme.accent('✓')
        : c.state === 'fail'
          ? theme.error('✗')
          : c.state === 'unavailable'
            ? theme.warning('⚠')
            : theme.muted('?');

    writeLine(io.stdout, '');
    for (const check of report.checks) {
      writeLine(
        io.stdout,
        `  ${glyph(check)} ${check.name.padEnd(11)} ${theme.muted(QUESTION[check.name])}`
      );
      writeLine(io.stdout, `      ${check.summary}`);
      for (const f of check.findings) {
        if (check.state === 'pass') continue;
        writeLine(io.stdout, theme.muted(`      · ${f.title}`));
      }
      writeLine(io.stdout, '');
    }

    if (report.failed.length) {
      writeLine(io.stdout, theme.error(`  Something you trusted has changed.`));
    } else if (report.notEstablished.length && !failOnUnknown) {
      // The line that keeps this command honest. A green run with an
      // unanswerable question in it is not a clean bill of health, and the one
      // place a user is most likely to read it as one is right here.
      writeLine(
        io.stdout,
        theme.muted(
          `  Nothing failed. ${report.notEstablished.join(', ')} could not be checked — that is not the same as clean.`
        )
      );
    } else if (report.ok) {
      writeLine(io.stdout, theme.accent('  Nothing you trusted has changed.'));
    }
    writeLine(io.stdout, '');
  }

  if (isGithubActions(io.env)) {
    for (const line of annotationsFor(report)) writeLine(io.stdout, line);
    writeJobSummary(io.env, report);
  }

  if (report.failed.length) return ExitCode.POLICY_FORBID;
  if (failOnUnknown && report.notEstablished.length) return ExitCode.POLICY_FORBID;
  // An unreachable OSV is a network condition, not a clean run and not a policy
  // hit. The exit contract already has a code for exactly this.
  if (report.unavailable.length) return ExitCode.NETWORK;
  return ExitCode.OK;
};
