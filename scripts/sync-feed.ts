// Regenerates feed/entries.json from OSV.
//
//   bun scripts/sync-feed.ts [--dry-run]
//
// This is the half of the revocation plane that used to need a human. Every MCP
// server in the catalog is looked up in OSV; anything with a live advisory
// becomes a revocation entry. `scripts/sign-feed.ts` then signs the result.
//
// The one rule that matters here: **an unreachable OSV must never empty the
// feed.** If a lookup fails, the existing entries for that package are kept and
// the script exits non-zero. Publishing "no advisories" because a service was
// down would be the single most damaging thing this automation could do —
// clients would cache a clean bill of health for a package that has one.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../src/atomic-write.js';
import { getMarketplaceItems } from '../src/catalog/bundled.js';
import { RevocationEntry } from '../src/model/revocation.js';
import { queryPurls } from '../src/osv/client.js';
import { toRevocationEntry } from '../src/osv/to-revocation.js';
import { npmPurl } from '../src/revocation/installed.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES_PATH = join(REPO, 'feed', 'entries.json');
const dryRun = process.argv.includes('--dry-run');

const source = existsSync(ENTRIES_PATH)
  ? (JSON.parse(readFileSync(ENTRIES_PATH, 'utf8')) as Record<string, unknown>)
  : {};
const existing = RevocationEntry.array().safeParse(source.entries ?? []);
if (!existing.success) {
  console.error(
    `sync-feed: feed/entries.json is not a valid entry list:\n${existing.error.message}`
  );
  process.exit(1);
}

const purls = [
  ...new Set(
    getMarketplaceItems()
      .map((item) => item.npmPackage)
      .filter((p): p is string => Boolean(p))
      .map((p) => npmPurl(p))
  )
];

console.log(`sync-feed: querying OSV for ${purls.length} MCP servers…`);
const lookups = await queryPurls(purls);

const unreachable = lookups.filter((l) => l.status === 'unreachable');
const reached = new Set(lookups.filter((l) => l.status === 'ok').map((l) => l.purl));

const fresh = lookups
  .flatMap((l) => (l.status === 'ok' ? l.vulns.map((v) => toRevocationEntry(v, l.purl)) : []))
  .sort((a, b) => a.id.localeCompare(b.id));

// Entries for packages we could not reach are carried over verbatim. Dropping
// them would silently un-revoke a package because of someone else's outage.
const carried = existing.data.filter((e) => !reached.has(e.purl_pattern));

const merged = [...fresh, ...carried]
  .filter(
    (e, i, all) => all.findIndex((x) => x.id === e.id && x.purl_pattern === e.purl_pattern) === i
  )
  .sort((a, b) => a.id.localeCompare(b.id) || a.purl_pattern.localeCompare(b.purl_pattern));

const bySeverity = (s: string) => merged.filter((e) => e.severity === s).length;
console.log(
  `sync-feed: ${merged.length} entries — ` +
    `${bySeverity('critical')} critical · ${bySeverity('high')} high · ${bySeverity('advisory')} advisory` +
    (carried.length ? ` (${carried.length} carried over from unreachable lookups)` : '')
);

if (dryRun) {
  console.log(JSON.stringify({ entries: merged }, null, 2));
} else {
  atomicWriteFile(
    ENTRIES_PATH,
    `${JSON.stringify({ $comment: source.$comment, entries: merged }, null, 2)}\n`
  );
  console.log(`sync-feed: wrote ${ENTRIES_PATH}`);
}

if (unreachable.length) {
  console.error(
    `sync-feed: ${unreachable.length} of ${purls.length} lookups failed — ` +
      `their existing entries were kept, not cleared.`
  );
  for (const u of unreachable.slice(0, 5)) {
    console.error(`  ${u.purl}: ${u.status === 'unreachable' ? u.reason : ''}`);
  }
  // Non-zero so a scheduled run surfaces as a failed job rather than quietly
  // publishing a partial view of the world.
  process.exit(1);
}
