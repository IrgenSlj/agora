import type { ParsedArgs, CliIo } from '../flags.js';
import type { Styler } from '../../ui.js';
import { writeLine, detectDataDir } from '../helpers.js';
import { curateAll, curationStatus } from '../../curator/index.js';
import { clearMarketplaceItemsCache, getCuratedSource } from '../../marketplace.js';

/**
 * Coerces a flag value (string | boolean | undefined) to a positive integer.
 * Returns `fallback` when the value is absent, non-numeric, or non-positive.
 */
export function parsePositiveIntFlag(
  value: string | boolean | undefined,
  fallback: number
): number {
  if (value === undefined || value === true || value === false) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export async function commandCurate(
  parsed: ParsedArgs,
  io: CliIo,
  _style: Styler
): Promise<number> {
  const dataDir = detectDataDir(parsed, io);

  if (parsed.flags.status === true) {
    const status = curationStatus(dataDir);
    writeLine(io.stdout, `Count:     ${status.count}`);
    writeLine(io.stdout, `Source:    ${status.source}`);
    writeLine(io.stdout, `Last run:  ${status.lastRunAt ?? 'never'}`);
    if (status.lastRunMode !== undefined) {
      writeLine(io.stdout, `Last mode: ${status.lastRunMode}`);
    }
    if (status.lastRunStats !== undefined) {
      const s = status.lastRunStats;
      writeLine(
        io.stdout,
        `Last stats: verified=${s.verified} reused=${s.reused} rejected=${s.rejected} fetchFailed=${s.fetchFailed} aiFailed=${s.aiFailed}`
      );
    }
    if (parsed.flags.json) {
      writeLine(io.stdout, JSON.stringify(status, null, 2));
    }
    return 0;
  }

  // Parse flags — note: flags arrive as strings from the CLI parser.
  const limit = parsePositiveIntFlag(parsed.flags.limit ?? parsed.flags.n, 50);
  const concurrency = parsePositiveIntFlag(parsed.flags.concurrency ?? parsed.flags.c, 4);
  const staleDays = parsePositiveIntFlag(parsed.flags.staleDays, 30);

  // Resolve mode
  const mode =
    parsed.flags.force === true
      ? 'force'
      : parsed.flags.refresh === true
        ? 'refresh'
        : 'incremental';

  const before = getCuratedSource();
  writeLine(io.stdout, `Current curation source: ${before}`);
  writeLine(io.stdout, `Mode: ${mode}  limit: ${limit}  concurrency: ${concurrency}`);

  const results = await curateAll(dataDir, {
    mode,
    staleDays,
    limit,
    concurrency,
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
