import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface AgoraSettings {
  account: { username: string; backend: string; declared_llm: string };
  display: { color: 'auto' | 'truecolor' | 'none'; banner: boolean };
  news: {
    sources: Record<string, { enabled: boolean; ttl_minutes: number }>;
    feeds?: string[];
  };
  community: { default_board: string; collapse_flag_threshold: number };
}

export const DEFAULT_SETTINGS: AgoraSettings = {
  account: { username: '', backend: '', declared_llm: '' },
  display: { color: 'auto', banner: true },
  news: {
    sources: {
      hn: { enabled: true, ttl_minutes: 10 },
      reddit: { enabled: true, ttl_minutes: 15 },
      'github-trending': { enabled: true, ttl_minutes: 30 },
      arxiv: { enabled: false, ttl_minutes: 60 },
      rss: { enabled: false, ttl_minutes: 60 },
    },
    feeds: [],
  },
  community: { default_board: 'mcp', collapse_flag_threshold: 3 },
};

const SETTINGS_FILE = 'settings.toml';

export function loadSettings(dataDir: string): AgoraSettings {
  const path = join(dataDir, SETTINGS_FILE);
  if (!existsSync(path)) return cloneSettings(DEFAULT_SETTINGS);
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parseToml(raw);
    return mergeSettings(cloneSettings(DEFAULT_SETTINGS), parsed);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function writeSettings(dataDir: string, settings: AgoraSettings): void {
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, SETTINGS_FILE);
  const tmp = `${path}.tmp`;
  const body = serializeToml(settings);
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

// ── Minimal TOML subset parser ──────────────────────────────────────────────
// Handles: sections, key = value (strings, booleans, integers, inline tables),
// comments (#), string arrays. No nested tables, no datetime, no dotted keys.

function parseToml(raw: string): Record<string, any> {
  const result: Record<string, any> = {};
  let currentSection: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    const kvMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = parseTomlValue(kvMatch[2]);
    if (currentSection) {
      result[currentSection][key] = value;
    } else {
      result[key] = value;
    }
  }

  return result;
}

function parseTomlValue(raw: string): any {
  const trimmed = raw.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const intMatch = trimmed.match(/^[-+]?\d+$/);
  if (intMatch) return parseInt(trimmed, 10);

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseInlineTable(trimmed.slice(1, -1));
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseTomlArray(trimmed.slice(1, -1));
  }

  return trimmed;
}

function parseInlineTable(raw: string): Record<string, any> {
  const obj: Record<string, any> = {};
  let depth = 0;
  let current = '';
  let currentKey: string | null = null;
  let mode: 'key' | 'value' = 'key';

  for (const ch of raw) {
    if (ch === '{') { depth++; current += ch; continue; }
    if (ch === '}') { depth--; current += ch; continue; }
    if (depth > 0) { current += ch; continue; }

    if (mode === 'key') {
      if (ch === '=') {
        currentKey = current.trim();
        current = '';
        mode = 'value';
      } else if (ch !== ' ' && ch !== ',') {
        current += ch;
      }
    } else {
      if (ch === ',' || ch === '}') {
        if (currentKey) obj[currentKey] = parseTomlValue(current.trim());
        currentKey = null;
        current = '';
        mode = 'key';
      } else if (ch !== ' ' || current.length > 0) {
        current += ch;
      }
    }
  }
  if (currentKey && mode === 'value') {
    obj[currentKey] = parseTomlValue(current.trim());
  }
  return obj;
}

function parseTomlArray(raw: string): any[] {
  const arr: any[] = [];
  let depth = 0;
  let current = '';

  for (const ch of raw) {
    if (ch === '[' || ch === '{') { depth++; current += ch; continue; }
    if (ch === ']' || ch === '}') { depth--; current += ch; continue; }
    if (depth > 0) { current += ch; continue; }

    if (ch === ',') {
      const v = current.trim();
      if (v) arr.push(parseTomlValue(v));
      current = '';
    } else {
      current += ch;
    }
  }
  const v = current.trim();
  if (v) arr.push(parseTomlValue(v));
  return arr;
}

// ── Minimal TOML serializer ──────────────────────────────────────────────────

function serializeToml(settings: AgoraSettings): string {
  const lines: string[] = ['# Agora settings', `# Generated ${new Date().toISOString().slice(0, 10)}`, ''];

  lines.push('[account]');
  lines.push(`username = ${JSON.stringify(settings.account.username)}`);
  lines.push(`backend = ${JSON.stringify(settings.account.backend)}`);
  lines.push(`declared_llm = ${JSON.stringify(settings.account.declared_llm)}`);
  lines.push('');

  lines.push('[display]');
  lines.push(`color = ${JSON.stringify(settings.display.color)}`);
  lines.push(`banner = ${String(settings.display.banner)}`);
  lines.push('');

  lines.push('[news]');
  lines.push(`feeds = ${JSON.stringify(settings.news.feeds ?? [])}`);
  lines.push('');

  for (const [key, src] of Object.entries(settings.news.sources)) {
    const cleanKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    lines.push(`[news.sources.${cleanKey}]`);
    lines.push(`enabled = ${String(src.enabled)}`);
    lines.push(`ttl_minutes = ${src.ttl_minutes}`);
    lines.push('');
  }

  lines.push('[community]');
  lines.push(`default_board = ${JSON.stringify(settings.community.default_board)}`);
  lines.push(`collapse_flag_threshold = ${settings.community.collapse_flag_threshold}`);
  lines.push('');

  return lines.join('\n');
}

function mergeSettings(defaults: AgoraSettings, parsed: Record<string, any>): AgoraSettings {
  if (parsed.account) {
    if (typeof parsed.account.username === 'string') defaults.account.username = parsed.account.username;
    if (typeof parsed.account.backend === 'string') defaults.account.backend = parsed.account.backend;
    if (typeof parsed.account.declared_llm === 'string') defaults.account.declared_llm = parsed.account.declared_llm;
  }
  if (parsed.display) {
    if (['auto', 'truecolor', 'none'].includes(parsed.display.color)) defaults.display.color = parsed.display.color;
    if (typeof parsed.display.banner === 'boolean') defaults.display.banner = parsed.display.banner;
  }
  if (parsed.news) {
    if (Array.isArray(parsed.news.feeds)) defaults.news.feeds = parsed.news.feeds;
    if (parsed.news.sources && typeof parsed.news.sources === 'object') {
      for (const [key, val] of Object.entries(parsed.news.sources)) {
        const src = val as any;
        if (src && typeof src === 'object') {
          defaults.news.sources[key] = {
            enabled: typeof src.enabled === 'boolean' ? src.enabled : true,
            ttl_minutes: typeof src.ttl_minutes === 'number' ? src.ttl_minutes : 60,
          };
        }
      }
    }
  }
  if (parsed.community) {
    if (typeof parsed.community.default_board === 'string') defaults.community.default_board = parsed.community.default_board;
    if (typeof parsed.community.collapse_flag_threshold === 'number') defaults.community.collapse_flag_threshold = parsed.community.collapse_flag_threshold;
  }
  return defaults;
}

function cloneSettings(s: AgoraSettings): AgoraSettings {
  return {
    account: { ...s.account },
    display: { ...s.display },
    news: {
      sources: Object.fromEntries(
        Object.entries(s.news.sources).map(([k, v]) => [k, { ...v }])
      ),
      feeds: [...(s.news.feeds ?? [])],
    },
    community: { ...s.community },
  };
}
