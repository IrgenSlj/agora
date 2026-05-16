import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HistoryEntry {
  type: 'search' | 'chat';
  query: string;
  timestamp: string;
  model?: string;
  results?: number;
  response?: string;
}

export function historyPath(dataDir: string): string {
  return join(dataDir, 'history.jsonl');
}

export function appendHistory(dataDir: string, entry: HistoryEntry): void {
  mkdirSync(dataDir, { recursive: true });
  appendFileSync(historyPath(dataDir), JSON.stringify(entry) + '\n', 'utf8');
}

export function loadHistory(dataDir: string, limit = 100): HistoryEntry[] {
  const path = historyPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const all: HistoryEntry[] = [];
    for (const line of raw.split('\n').filter(Boolean).reverse()) {
      try {
        all.push(JSON.parse(line));
      } catch {
        continue;
      }
      if (all.length >= limit) break;
    }
    return all;
  } catch {
    return [];
  }
}

export function clearHistory(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(historyPath(dataDir), '', 'utf8');
}
