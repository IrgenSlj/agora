/**
 * Refresh live hub data from GitHub and HuggingFace.
 * Run with: AGORA_LIVE_HUBS=1 bun scripts/refresh-hubs.ts
 *
 * Calls searchGithub() and searchHuggingFace(), merges results, and writes
 * to ~/.config/agora/hubs-cache.jsonl.
 * Set AGORA_GITHUB_TOKEN to avoid GitHub rate limits (60 req/hr unauth, 5000 auth).
 */

import { searchGithub } from '../src/hubs/github.js';
import { searchHuggingFace } from '../src/hubs/huggingface.js';
import { writeHubsCache } from '../src/hubs/cache.js';
import { detectAgoraDataDir } from '../src/state.js';

const dataDir = detectAgoraDataDir({ env: process.env as Record<string, string | undefined> });

console.log(`Writing hub cache to: ${dataDir}`);

try {
  const [ghItems, hfItems] = await Promise.all([
    searchGithub({ token: process.env.AGORA_GITHUB_TOKEN }),
    searchHuggingFace()
  ]);
  const items = [...ghItems, ...hfItems];
  writeHubsCache(dataDir, items);
  console.log(
    `Fetched and cached ${items.length} hub items (${ghItems.length} GitHub, ${hfItems.length} HuggingFace).`
  );
} catch (err) {
  console.error('Failed to refresh hubs:', err);
  process.exit(1);
}
