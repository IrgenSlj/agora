// `agora report`: the evidence report, from git notes alone.

import { basename, resolve } from 'node:path';
import { atomicWriteFile } from '../../atomic-write.js';
import { repoRoot } from '../../receipt/git.js';
import { buildReport } from '../../report/build.js';
import { renderReportHtml } from '../../report/html.js';
import { status } from '../components.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

export const commandReport: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const cwd = io.cwd ?? process.cwd();
  const repo = repoRoot(cwd);
  if (!repo) return usageError(io, 'agora report works inside a git repository.');

  let report: Awaited<ReturnType<typeof buildReport>>;
  try {
    report = await buildReport({
      repo,
      name: basename(repo),
      rev: stringFlag(parsed, 'rev'),
      since: stringFlag(parsed, 'since'),
      until: stringFlag(parsed, 'until')
    });
  } catch (e) {
    return usageError(io, `could not read the history: ${e instanceof Error ? e.message : e}`);
  }
  const code = report.totals.invalid ? ExitCode.POLICY_FORBID : ExitCode.OK;

  if (parsed.flags.json) {
    writeJson(io.stdout, report);
    return code;
  }
  const out = resolve(cwd, stringFlag(parsed, 'out') ?? 'agora-report.html');
  atomicWriteFile(out, renderReportHtml(report), 0o644);
  const t = report.totals;
  writeLine(
    io.stdout,
    status(
      t.invalid ? 'error' : t.missing ? 'warning' : 'success',
      `${t.valid} of ${t.commits} commits carry a receipt that verifies` +
        (t.invalid ? ` · ${t.invalid} rejected` : '') +
        (t.missing ? ` · ${t.missing} not established` : ''),
      theme
    )
  );
  writeLine(io.stdout, theme.dim(`  wrote ${out}`));
  return code;
};
