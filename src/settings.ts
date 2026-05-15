/**
 * Agora settings — persisted to `~/.config/agora/settings.toml`.
 *
 * **Stub** — the loader/writer is implemented in a later PR (alongside the
 * proper toml parser). The TUI settings page already references this module,
 * so it lives here as a typed surface that returns a default in-memory
 * object. Edits made through the TUI stay in memory until the persistence
 * layer lands.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface AgoraSettings {
  account: { username: string; backend: string; declared_llm: string };
  display: { color: 'auto' | 'truecolor' | 'none'; banner: boolean };
  news: { sources: Record<string, { enabled: boolean; ttl_minutes: number }> };
  community: { default_board: string; collapse_flag_threshold: number };
}

export const DEFAULT_SETTINGS: AgoraSettings = {
  account: { username: '', backend: '', declared_llm: '' },
  display: { color: 'auto', banner: true },
  news: {
    sources: {
      hn: { enabled: true, ttl_minutes: 10 },
      reddit_mcp: { enabled: true, ttl_minutes: 15 },
      reddit_localllama: { enabled: true, ttl_minutes: 15 },
      arxiv_csai: { enabled: false, ttl_minutes: 60 }
    }
  },
  community: { default_board: 'mcp', collapse_flag_threshold: 3 }
};

const SETTINGS_FILE = 'settings.toml';

/**
 * Read settings from disk. Returns the defaults when the file does not exist
 * or cannot be parsed. The real toml parser ships in a later PR; for now we
 * only read the file's *presence* — if it exists we still return defaults
 * (good enough for the TUI to compile and render).
 */
export function loadSettings(dataDir: string): AgoraSettings {
  const path = join(dataDir, SETTINGS_FILE);
  if (!existsSync(path)) return cloneSettings(DEFAULT_SETTINGS);
  try {
    readFileSync(path, 'utf8');
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
  // TODO: parse toml. Until then, we round-trip defaults.
  return cloneSettings(DEFAULT_SETTINGS);
}

/**
 * Write settings to disk. The serialiser ships in a later PR; for now we
 * write a placeholder note so the file exists and round-trips on next load.
 */
export function writeSettings(dataDir: string, settings: AgoraSettings): void {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, SETTINGS_FILE);
  const tmp = `${path}.tmp`;
  // TODO: real toml serialiser. Stub format that the future parser will accept.
  const body = `# Agora settings — stub serialiser (real toml writer lands in a later PR)\n# username = ${JSON.stringify(settings.account.username)}\n`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore on platforms that don't support chmod
  }
}

function cloneSettings(s: AgoraSettings): AgoraSettings {
  return {
    account: { ...s.account },
    display: { ...s.display },
    news: { sources: Object.fromEntries(Object.entries(s.news.sources).map(([k, v]) => [k, { ...v }])) },
    community: { ...s.community }
  };
}
