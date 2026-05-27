import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SHELL_HISTORY_FILE = 'shell-history.jsonl';
export const SHELL_HISTORY_MAX = 2000;

export function getShellHistoryPath(dataDir: string): string {
  return join(dataDir, SHELL_HISTORY_FILE);
}

export function loadShellHistory(dataDir: string): string[] {
  const path = getShellHistoryPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const entries: string[] = [];
    for (const line of raw.split('\n').filter(Boolean).reverse()) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.line) entries.push(parsed.line);
      } catch {
        continue;
      }
      if (entries.length >= SHELL_HISTORY_MAX) break;
    }
    return entries;
  } catch {
    return [];
  }
}

export function appendShellHistory(dataDir: string, line: string): void {
  const path = getShellHistoryPath(dataDir);
  try {
    appendFileSync(path, JSON.stringify({ line, ts: new Date().toISOString() }) + '\n', 'utf8');
  } catch {
    // best-effort
  }
}
