import type { ParsedArgs, CliIo } from '../flags.js';
import type { Styler } from '../../ui.js';
import { writeLine, detectDataDir } from '../helpers.js';
import { curateAll } from '../../curator/index.js';
import { clearMarketplaceItemsCache, getCuratedSource } from '../../marketplace.js';

export async function commandCurate(
  parsed: ParsedArgs,
  io: CliIo,
  _style: Styler
): Promise<number> {
  const force = parsed.flags.force === true;
  const limit = typeof parsed.flags.limit === 'number' ? parsed.flags.limit : 50;
  const dataDir = detectDataDir(parsed, io);

  const before = getCuratedSource();
  writeLine(io.stdout, `Current curation source: ${before}`);
  writeLine(io.stdout, `${force ? 'Force re-verify' : 'Incremental verify'} (limit: ${limit})`);

  const results = await curateAll(dataDir, {
    force,
    limit,
    onProgress: (msg) => writeLine(io.stdout, msg)
  });

  clearMarketplaceItemsCache();
  const after = getCuratedSource();
  writeLine(io.stdout, `\nCuration complete: ${results.length} items`);
  writeLine(io.stdout, `Curation source now: ${after}`);

  if (parsed.flags.json) {
    writeLine(
      io.stdout,
      JSON.stringify({ count: results.length, source: after, items: results }, null, 2)
    );
  }

  return 0;
}
