import { join } from 'node:path';
import { refreshOfficialCache } from '../../federation/cache.js';
import type { FederationEnv } from '../../federation/types.js';
import { ExitCode } from '../exit-codes.js';
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

  const dataDir = detectDataDir(parsed, io);
  const env: FederationEnv = {
    fetcher: io.fetcher,
    env: io.env,
    home: io.env?.HOME,
    cacheDir: join(dataDir, 'federation'),
    storePath: stringFlag(parsed, 'store') || join(dataDir, 'agora.db')
  };

  const result = await refreshOfficialCache(env);

  if (parsed.flags.json) {
    writeJson(io.stdout, result);
    return result.error ? ExitCode.NETWORK : ExitCode.OK;
  }

  if (result.error) {
    writeLine(io.stderr, `official refresh failed: ${result.error}`);
    writeLine(
      io.stdout,
      `Partial sync — +${result.added} added, ~${result.updated} updated, -${result.pruned} pruned (cache now has ${result.total})`
    );
    return ExitCode.NETWORK;
  }

  writeLine(
    io.stdout,
    `official: +${result.added} added, ~${result.updated} updated, -${result.pruned} pruned (cache now has ${result.total})`
  );
  writeLine(io.stdout, style.dim(`synced at ${result.syncedAt}`));
  if (result.storeError) writeLine(io.stderr, `local store update failed: ${result.storeError}`);
  return ExitCode.OK;
};
