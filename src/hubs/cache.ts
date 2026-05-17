import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HubItem } from './types.js';

const MAX_ITEMS = 2000;

export function hubsCachePath(dataDir: string): string {
  return join(dataDir, 'hubs-cache.jsonl');
}

export function readHubsCache(dataDir: string): HubItem[] {
  const path = hubsCachePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const items: HubItem[] = [];
    for (const line of raw.split('\n').filter(Boolean)) {
      try {
        items.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function writeHubsCache(dataDir: string, items: HubItem[]): void {
  mkdirSync(dataDir, { recursive: true });
  const path = hubsCachePath(dataDir);

  const sorted = [...items].sort(
    (a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime()
  );
  const trimmed = sorted.slice(0, MAX_ITEMS);

  const lines = trimmed.map((item) => JSON.stringify(item));
  writeFileSync(path, lines.join('\n') + '\n', 'utf8');
}

export function isHubCacheStale(items: HubItem[], ttlMinutes: number, now: Date): boolean {
  if (items.length === 0) return true;
  const latest = items.reduce((latest, item) => {
    const t = new Date(item.fetchedAt).getTime();
    return t > latest ? t : latest;
  }, 0);
  const ageMs = now.getTime() - latest;
  return ageMs > ttlMinutes * 60 * 1000;
}
