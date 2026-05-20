/**
 * Run AI-powered curation to discover, verify, and catalog marketplace items.
 * Cached curated data replaces the human-curated samplePackages from data.ts.
 *
 * Usage:
 *   bun scripts/curate.ts                  # runs full curation
 *   bun scripts/curate.ts --force          # re-verify every item
 *   bun scripts/curate.ts --limit 20       # only process top 20 candidates
 *
 * Reads ~/.config/agora/curation-cache.json on success.
 */

import { curateAll } from '../src/curator/index.js';
import { detectAgoraDataDir } from '../src/state.js';

const force = process.argv.includes('--force');
const limitIndex = process.argv.indexOf('--limit');
const limit = limitIndex >= 0 ? parseInt(process.argv[limitIndex + 1] ?? '50', 10) : 50;

const dataDir = detectAgoraDataDir({ env: process.env as Record<string, string | undefined> });

console.log(`Curation data dir: ${dataDir}`);
console.log(`Force re-verify: ${force}`);
console.log(`Item limit: ${limit}`);

curateAll(dataDir, { force, limit, onProgress: (msg) => console.log(msg) })
  .then((items) => {
    console.log(`\nCuration complete: ${items.length} items in cache`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Curation failed:', err);
    process.exit(1);
  });
