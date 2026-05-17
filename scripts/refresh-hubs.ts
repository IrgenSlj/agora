/**
 * Refresh live hub data from GitHub.
 * Run with: AGORA_LIVE_HUBS=1 bun scripts/refresh-hubs.ts
 *
 * Calls searchGithub() and writes results to ~/.config/agora/hubs-cache.jsonl.
 * Set AGORA_GITHUB_TOKEN to avoid rate limits (60 req/hr unauth, 5000 auth).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { searchGithub } from '../src/hubs/github.js';
import { writeHubsCache } from '../src/hubs/cache.js';
import { detectAgoraDataDir } from '../src/state.js';

const dataDir = detectAgoraDataDir({ env: process.env as Record<string, string | undefined> });

console.log(`Writing hub cache to: ${dataDir}`);

try {
  const items = await searchGithub({ token: process.env.AGORA_GITHUB_TOKEN });
  writeHubsCache(dataDir, items);
  console.log(`Fetched and cached ${items.length} hub items.`);
} catch (err) {
  console.error('Failed to refresh hubs:', err);
  process.exit(1);
}
