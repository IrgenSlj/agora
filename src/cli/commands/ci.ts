// `agora ci`: one verdict a pull request can carry, with an exit code.
//
// Read-only by construction: it queries OSV and reads host configs. It starts
// no servers, because a CI runner executing a stranger's configured processes
// on a pull request is worse than anything this command could report.

import { writeFileSync } from 'node:fs';
import { annotationsFor, isGithubActions, writeJobSummary } from '../../ci/github.js';
import { type CiCheck, runCiChecks } from '../../ci/report.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

const QUESTION: Record<CiCheck['name'], string> = {
  receipts: 'made within policy',
  advisories: 'known-vulnerable'
};

export const commandCi: CommandHandler = async (parsed, io, style) => {
  const failOnUnknown =
    parsed.flags.failOnUnknown === true || parsed.flags['fail-on-unknown'] === true;

  const range = stringFlag(parsed, 'range');
  const require = stringFlag(parsed, 'require-signer') ?? stringFlag(parsed, 'requireSigner');
  if (require && !['none', 'local-keychain', 'runner-oidc'].includes(require)) {
    writeLine(
      io.stderr,
      `--require-signer must be none, local-keychain or runner-oidc, not ${require}`
    );
    return ExitCode.USAGE;
  }
  const report = await runCiChecks(io, {
    failOnUnknown,
    ...(range ? { range } : {}),
    ...(require ? { requireSigner: require as 'none' | 'local-keychain' | 'runner-oidc' } : {})
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
      writeLine(io.stdout, theme.error('  A configured server has a blocking advisory.'));
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
      writeLine(
        io.stdout,
        theme.accent('  No known blocking advisories. That is not the same as safe.')
      );
    }
    writeLine(io.stdout, '');
  }

  if (isGithubActions(io.env)) {
    for (const line of annotationsFor(report)) writeLine(io.stdout, line);
    writeJobSummary(io.env, report);
  }

  if (report.failed.length) return ExitCode.POLICY_FORBID;
  // Could not check: OSV unreachable, or nothing to check under --fail-on-unknown.
  if (report.unavailable.length) return ExitCode.COULD_NOT_CHECK;
  if (failOnUnknown && report.notEstablished.length) return ExitCode.COULD_NOT_CHECK;
  return ExitCode.OK;
};
