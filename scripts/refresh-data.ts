/**
 * Refresh marketplace data script.
 * Run with: bun scripts/refresh-data.ts
 *
 * For each package with an npmPackage field, fetches the latest version from
 * the npm registry and surgically replaces only the version: '...' line in
 * src/data.ts, and also fetches weekly download counts (mapped to `installs`)
 * from the npm downloads API and surgically replaces the installs: <number>
 * line. Packages that 404 or error are skipped with a warning.
 * Also updates the dataRefreshedAt constant to today's date.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { samplePackages } from '../src/data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_TS_PATH = join(__dirname, '../src/data.ts');
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const CONCURRENCY = 8;

interface NpmLatestResponse {
  version: string;
}

interface NpmDownloadsResponse {
  downloads: number;
}

async function fetchLatestVersion(npmPackage: string): Promise<string | null> {
  const url = `https://registry.npmjs.org/${npmPackage}/latest`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as NpmLatestResponse;
    return data.version ?? null;
  } catch {
    return null;
  }
}

async function fetchWeeklyDownloads(npmPackage: string): Promise<number | null> {
  const url = `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(npmPackage)}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as NpmDownloadsResponse;
    return data.downloads ?? null;
  } catch {
    return null;
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Only packages that have an npmPackage field
const candidates = samplePackages.filter((p) => Boolean(p.npmPackage));

type FetchResult =
  | { id: string; npmPackage: string; newVersion: string; newInstalls?: number; status: 'updated' }
  | { id: string; npmPackage: string; status: 'skipped'; reason: string };

const tasks = candidates.map((pkg) => async (): Promise<FetchResult> => {
  const npmPackage = pkg.npmPackage!;
  const [fetched, downloads] = await Promise.all([
    fetchLatestVersion(npmPackage),
    fetchWeeklyDownloads(npmPackage)
  ]);
  if (fetched === null) {
    console.warn(`  [warn] ${pkg.id} (${npmPackage}) — not found or error, skipped`);
    return { id: pkg.id, npmPackage, status: 'skipped', reason: 'not found or fetch error' };
  }
  if (fetched !== pkg.version) {
    console.log(`  [ok]   ${pkg.id}: ${pkg.version} → ${fetched}`);
  }
  return {
    id: pkg.id,
    npmPackage,
    newVersion: fetched,
    ...(downloads !== null ? { newInstalls: downloads } : {}),
    status: 'updated'
  };
});

console.log(
  `Fetching npm metadata for ${candidates.length} packages (concurrency: ${CONCURRENCY})…`
);
const results = await runWithConcurrency(tasks, CONCURRENCY);

// Build a map of id -> new version (only for 'updated' results)
const updates = new Map<string, string>();
const installsUpdates = new Map<string, number>();
for (const r of results) {
  if (r.status === 'updated') {
    updates.set(r.id, r.newVersion);
    if (r.newInstalls !== undefined) {
      installsUpdates.set(r.id, r.newInstalls);
    }
  }
}

// Surgical text transformation of src/data.ts
let content = readFileSync(DATA_TS_PATH, 'utf8');

for (const [id, newVersion] of updates) {
  // Find the block for this package by its id field, then replace its version line.
  // We locate a region starting at `id: '<id>'` and ending at the next `},` or `}` to
  // constrain our replacement to that block.
  const idMarker = `id: '${id}'`;
  const idIndex = content.indexOf(idMarker);
  if (idIndex === -1) {
    console.warn(`  [warn] Could not locate id marker for ${id}, skipping text update`);
    continue;
  }

  // Find the end of this package's block: next occurrence of `  },` or `  }` at top level
  const commaEnd = content.indexOf('\n  },', idIndex);
  const noCommaEnd = content.indexOf('\n  }', idIndex);
  const blockEndIndex =
    commaEnd === -1 ? noCommaEnd : noCommaEnd === -1 ? commaEnd : Math.min(commaEnd, noCommaEnd);
  if (blockEndIndex === -1) {
    console.warn(`  [warn] Could not locate block end for ${id}, skipping text update`);
    continue;
  }

  // Determine the actual terminator length (with or without trailing comma)
  const hasTrailingComma = content.startsWith('\n  },', blockEndIndex);
  const terminatorLength = hasTrailingComma ? '\n  },'.length : '\n  }'.length;

  // Extract the block
  const blockStart = idIndex;
  const blockEnd = blockEndIndex + terminatorLength;
  const block = content.slice(blockStart, blockEnd);

  // Replace the version line within the block
  const updatedBlock = block.replace(/version: '([^']+)'/, `version: '${newVersion}'`);

  if (updatedBlock === block) {
    // No change — either version already matches or pattern not found
    continue;
  }

  content = content.slice(0, blockStart) + updatedBlock + content.slice(blockEnd);
}

// Surgical text transformation: update installs fields
for (const [id, newInstalls] of installsUpdates) {
  const idMarker = `id: '${id}'`;
  const idIndex = content.indexOf(idMarker);
  if (idIndex === -1) {
    console.warn(`  [warn] Could not locate id marker for ${id}, skipping installs update`);
    continue;
  }

  const commaEnd = content.indexOf('\n  },', idIndex);
  const noCommaEnd = content.indexOf('\n  }', idIndex);
  const blockEndIndex =
    commaEnd === -1 ? noCommaEnd : noCommaEnd === -1 ? commaEnd : Math.min(commaEnd, noCommaEnd);
  if (blockEndIndex === -1) {
    console.warn(`  [warn] Could not locate block end for ${id}, skipping installs update`);
    continue;
  }

  const hasTrailingComma = content.startsWith('\n  },', blockEndIndex);
  const terminatorLength = hasTrailingComma ? '\n  },'.length : '\n  }'.length;

  const blockStart = idIndex;
  const blockEnd = blockEndIndex + terminatorLength;
  const block = content.slice(blockStart, blockEnd);

  const updatedBlock = block.replace(/installs: \d+/, `installs: ${newInstalls}`);

  if (updatedBlock === block) {
    continue;
  }

  content = content.slice(0, blockStart) + updatedBlock + content.slice(blockEnd);
}

// Update the dataRefreshedAt constant
content = content.replace(
  /export const dataRefreshedAt = '[^']*';/,
  `export const dataRefreshedAt = '${TODAY}';`
);

writeFileSync(DATA_TS_PATH, content, 'utf8');
console.log(`\nUpdated src/data.ts  (dataRefreshedAt = '${TODAY}')`);

// Summary
const updatedCount = results.filter((r) => r.status === 'updated').length;
const skippedCount = results.filter((r) => r.status === 'skipped').length;
const installsUpdatedCount = installsUpdates.size;
console.log(`\nSummary: ${updatedCount} updated, ${skippedCount} skipped/not-found, ${installsUpdatedCount} installs fields updated`);
