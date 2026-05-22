import { findMarketplaceItem } from '../../marketplace.js';
import { scanItem } from '../../scan.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError } from '../helpers.js';

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

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return 0;
  }

  writeLine(io.stdout, `Scan: ${item.name} ${style.dim('(' + item.id + ')')}`);
  writeLine(io.stdout);

  const labelWidth = Math.max(...result.checks.map((c) => c.label.length));
  for (const check of result.checks) {
    const icon =
      check.status === 'pass'
        ? style.accent('✓')
        : check.status === 'warn'
          ? style.orange('⚠')
          : style.bold('✗');
    writeLine(io.stdout, `  ${icon}  ${check.label.padEnd(labelWidth)}  ${check.message}`);
  }

  writeLine(io.stdout);
  const { pass, warn, fail } = result.summary;
  writeLine(io.stdout, `${pass} pass · ${warn} warning(s) · ${fail} failure(s)`);

  return fail > 0 ? 1 : 0;
};
