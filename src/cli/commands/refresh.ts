import { join } from 'node:path';
import { refreshOfficialCache } from '../../federation/cache.js';
import type { FederationEnv } from '../../federation/types.js';
import { detectDataDir, stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

export const commandRefresh: CommandHandler = async (parsed, io, style) => {
  const source = stringFlag(parsed, 'source') || 'official';
  if (source !== 'official') {
    return usageError(
      io,
      `agora refresh only supports --source official today (got "${source}"). ` +
        '"local" is the bundled catalog and needs no refresh.'
    );
  }

  const env: FederationEnv = {
    fetcher: io.fetcher,
    env: io.env,
    home: io.env?.HOME,
    cacheDir: join(detectDataDir(parsed, io), 'federation')
  };

  const result = await refreshOfficialCache(env);

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return result.error ? 1 : 0;
  }

  if (result.error) {
    writeLine(io.stderr, `official refresh failed: ${result.error}`);
    writeLine(
      io.stdout,
      `Partial sync — +${result.added} added, ~${result.updated} updated, -${result.pruned} pruned (cache now has ${result.total})`
    );
    return 1;
  }

  writeLine(
    io.stdout,
    `official: +${result.added} added, ~${result.updated} updated, -${result.pruned} pruned (cache now has ${result.total})`
  );
  writeLine(io.stdout, style.dim(`synced at ${result.syncedAt}`));
  return 0;
};
