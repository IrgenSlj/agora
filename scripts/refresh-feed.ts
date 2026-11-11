// Re-derives every entry in the bundled revocation list from its OSV record.
//
// Run by a maintainer before a release (`bun run refresh:feed`). It does not
// discover new advisories: `agora audit` queries OSV live for the servers a
// user actually runs. The bundled list is the offline floor the hook reads.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { narrowToPackage, versionRangeFor } from '../src/osv/to-revocation.js';
import type { OsvVulnerability } from '../src/osv/types.js';

const path = join(import.meta.dir, '..', 'feed', 'revocations.json');
const feed = JSON.parse(readFileSync(path, 'utf8'));
let changed = 0;

for (const entry of feed.entries) {
  const res = await fetch(`https://api.osv.dev/v1/vulns/${entry.id}`);
  if (!res.ok) {
    console.error(`unreachable: ${entry.id} (${res.status}) — left as it was`);
    continue;
  }
  const vuln = (await res.json()) as OsvVulnerability;
  const next = versionRangeFor(narrowToPackage(vuln, entry.purl_pattern));
  if (next === entry.versions) continue;
  console.log(`${entry.id}: ${JSON.stringify(entry.versions)} -> ${JSON.stringify(next)}`);
  if (next) entry.versions = next;
  else delete entry.versions;
  changed++;
}

feed.generated_at = new Date().toISOString();
writeFileSync(path, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`${changed} entr${changed === 1 ? 'y' : 'ies'} changed`);
