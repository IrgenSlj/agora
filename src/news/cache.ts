import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  chmodSync
} from 'node:fs';
import { join } from 'node:path';
import type { NewsItem, NewsSource } from './types.js';

function atomicWrite(path: string, body: string, mode = 0o600): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode });
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    /* ignore */
  }
}

const MAX_ITEMS = 2000;

export function cachePath(dataDir: string): string {
  return join(dataDir, 'news-cache.jsonl');
}

export function readCache(dataDir: string): NewsItem[] {
  const path = cachePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const items: NewsItem[] = [];
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

export function writeCache(dataDir: string, items: NewsItem[]): void {
  mkdirSync(dataDir, { recursive: true });
  const path = cachePath(dataDir);

  const sorted = [...items].sort(
    (a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime()
  );
  const trimmed = sorted.slice(0, MAX_ITEMS);

  const lines = trimmed.map((item) => JSON.stringify(item));
  atomicWrite(path, lines.join('\n') + '\n');
}

export interface NewsMeta {
  read: string[];
  saved: string[];
}

export function metaPath(dataDir: string): string {
  return join(dataDir, 'news-meta.json');
}

export function readNewsMeta(dataDir: string): NewsMeta {
  const path = metaPath(dataDir);
  if (!existsSync(path)) return { read: [], saved: [] };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { read: [], saved: [] };
  }
}

export function writeNewsMeta(dataDir: string, meta: NewsMeta): void {
  mkdirSync(dataDir, { recursive: true });
  atomicWrite(metaPath(dataDir), JSON.stringify(meta, null, 2));
}

export function isStale(
  items: NewsItem[],
  source: NewsSource,
  ttlMinutes: number,
  now: Date
): boolean {
  const sourceItems = items.filter((item) => item.source === source);
  if (sourceItems.length === 0) return true;
  const latest = sourceItems.reduce((latest, item) => {
    const t = new Date(item.fetchedAt).getTime();
    return t > latest ? t : latest;
  }, 0);
  const ageMs = now.getTime() - latest;
  return ageMs > ttlMinutes * 60 * 1000;
}
