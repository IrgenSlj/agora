import { findMarketplaceItem } from '../../marketplace.js';
import { scanItem } from '../../scan.js';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import { status } from '../pages/components.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

/**
 * Exit codes (brief §9): 0 pass/ok · 1 policy forbid (scan fail) ·
 * 2 usage error. Warnings are informational (0).
 */
function scanExitCode(summary: { pass: number; warn: number; fail: number }): number {
  if (summary.fail > 0) return ExitCode.POLICY_FORBID;
  return ExitCode.OK;
}

export const commandScan: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) {
    return usageError(
      io,
      'scan requires an item id. Usage: agora scan <id> [--type package|workflow]'
    );
  }

  const item = findMarketplaceItem(id, { type: stringFlag(parsed, 'type') });
  if (!item) {
    return usageError(io, `Item not found: ${id}`);
  }

  const githubToken = io.env?.AGORA_GITHUB_TOKEN;
  const result = await scanItem(item, { fetcher: io.fetcher, githubToken });
  const exitCode = scanExitCode(result.summary);

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return exitCode;
  }

  const theme = cliTheme(style, io);

  writeLine(io.stdout, `Scan: ${item.name} ${theme.dim('(' + item.id + ')')}`);
  writeLine(io.stdout);

  const labelWidth = Math.max(...result.checks.map((c) => c.label.length));
  for (const check of result.checks) {
    const icon =
      check.status === 'pass'
        ? status('success', '', theme)
        : check.status === 'warn'
          ? status('warning', '', theme)
          : status('error', '', theme);
    writeLine(io.stdout, `  ${icon}  ${check.label.padEnd(labelWidth)}  ${check.message}`);
  }

  writeLine(io.stdout);
  const { pass, warn, fail } = result.summary;
  writeLine(io.stdout, `${pass} pass · ${warn} warning(s) · ${fail} failure(s)`);

  return exitCode;
};
