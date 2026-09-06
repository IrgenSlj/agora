// Regenerates feed/entries.json from OSV.
//
//   bun scripts/sync-feed.ts [--dry-run] [--catalog-only]
//
// This is the half of the revocation plane that used to need a human. Every
// known MCP server is looked up in OSV; anything with a live advisory becomes a
// revocation entry. `scripts/sign-feed.ts` then signs the result.
//
// The artifact universe is the official MCP registry, walked in full — not the
// bundled sample catalog, which is what it used to be. Thirty hand-listed
// packages made coverage an accident of a maintained file, and a feed that has
// never heard of an artifact cannot answer the one question it exists for. The
// sample catalog is still unioned in as a floor so a registry outage cannot
// narrow what we already covered.
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
import { enumerateNamespace } from '../src/revocation/namespace.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES_PATH = join(REPO, 'feed', 'entries.json');
const dryRun = process.argv.includes('--dry-run');
const catalogOnly = process.argv.includes('--catalog-only');

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

const catalogPurls = getMarketplaceItems()
  .map((item) => item.npmPackage)
  .filter((p): p is string => Boolean(p))
  .map((p) => npmPurl(p));

let namespaceIncomplete: string | undefined;
let registryPurls: string[] = [];

if (catalogOnly) {
  console.log('sync-feed: --catalog-only, skipping the registry walk');
} else {
  console.log('sync-feed: walking the official registry…');
  const ns = await enumerateNamespace({
    env: {},
    onPage: (pages, found) => {
      if (pages % 10 === 0) console.log(`  ${pages} pages, ${found} npm artifacts`);
    }
  });
  registryPurls = ns.purls;
  console.log(
    `sync-feed: ${ns.servers} servers over ${ns.pages} pages → ${ns.purls.length} npm artifacts` +
      (ns.complete ? '' : ' (INCOMPLETE)')
  );
  if (!ns.complete) namespaceIncomplete = ns.reason;
}

// Union, never replacement. An incomplete walk must not shrink coverage below
// what the curated catalog already guaranteed.
const purls = [...new Set([...registryPurls, ...catalogPurls])].sort();

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

if (namespaceIncomplete) {
  console.error(`sync-feed: registry enumeration was incomplete — ${namespaceIncomplete}`);
  console.error(
    '  Artifacts on the pages that were never read are not "clean"; they were not asked about. ' +
      'Their existing entries were kept.'
  );
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

// Same reasoning as an unreachable lookup: the feed it produced is usable, but
// the run is not a clean one and a scheduled job should say so.
if (namespaceIncomplete) process.exit(1);
