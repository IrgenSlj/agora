import { detectOpenCodeConfigPath, loadOpenCodeConfig } from '../../config-files.js';
import { extractPackageFromConfig } from '../../config.js';
import { checkOutdated } from '../../outdated.js';
import type { CommandHandler } from './types.js';
import { writeLine, writeJson, stringFlag, usageError } from '../helpers.js';
import { cliTheme } from '../theme.js';
import { status } from '../pages/components.js';

export const commandOutdated: CommandHandler = async (parsed, io, style) => {
  const theme = cliTheme(style, io);
  const path = detectOpenCodeConfigPath({
    explicitPath: stringFlag(parsed, 'config'),
    cwd: io.cwd,
    env: io.env,
    home: io.env?.HOME
  });

  const loaded = loadOpenCodeConfig(path);
  if (loaded.error) {
    return usageError(io, `Could not read ${path}: ${loaded.error}`);
  }

  const packages = extractPackageFromConfig(loaded.config);

  if (packages.length === 0) {
    if (parsed.flags.json) {
      writeJson(io.stdout, { entries: [], summary: { fresh: 0, stale: 0, unknown: 0 } });
    } else {
      writeLine(io.stdout, theme.muted('No MCP packages found in ' + path));
    }
    return 0;
  }

  const result = await checkOutdated(packages, { fetcher: io.fetcher });

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return 0;
  }

  writeLine(io.stdout, `Outdated check: ${packages.length} MCP package(s)`);
  writeLine(io.stdout);

  const nameWidth = Math.max(...result.entries.map((e) => e.pkg.length));
  for (const entry of result.entries) {
    const icon =
      entry.status === 'fresh'
        ? status('success', '', theme)
        : entry.status === 'stale'
          ? status('warning', '', theme)
          : theme.info('?');
    const suffix = entry.status === 'stale' ? ' — may be unmaintained' : '';
    writeLine(io.stdout, `  ${icon}  ${entry.pkg.padEnd(nameWidth)}  ${entry.message}${suffix}`);
  }

  writeLine(io.stdout);
  const { fresh, stale, unknown } = result.summary;
  writeLine(io.stdout, `${fresh} fresh · ${stale} stale · ${unknown} unknown`);

  return 0;
};
