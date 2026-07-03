import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import { atomicWriteFile } from './atomic-write.js';

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
      'github-trending': { enabled: true, ttl_minutes: 30 },
      arxiv: { enabled: false, ttl_minutes: 60 },
      rss: { enabled: false, ttl_minutes: 60 }
    },
    feeds: []
  },
  community: { default_board: 'mcp', collapse_flag_threshold: 3 }
};

const SETTINGS_FILE = 'settings.toml';

export function loadSettings(dataDir: string): AgoraSettings {
  const path = join(dataDir, SETTINGS_FILE);
  if (!existsSync(path)) return cloneSettings(DEFAULT_SETTINGS);
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = parse(raw) as Record<string, any>;
    return mergeSettings(cloneSettings(DEFAULT_SETTINGS), parsed);
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export function writeSettings(dataDir: string, settings: AgoraSettings): void {
  const output = stringify(settings as any);
  atomicWriteFile(join(dataDir, SETTINGS_FILE), output);
}

function mergeSettings(defaults: AgoraSettings, parsed: Record<string, any>): AgoraSettings {
  if (parsed.account) {
    if (typeof parsed.account.username === 'string')
      defaults.account.username = parsed.account.username;
    if (typeof parsed.account.backend === 'string')
      defaults.account.backend = parsed.account.backend;
    if (typeof parsed.account.declared_llm === 'string')
      defaults.account.declared_llm = parsed.account.declared_llm;
  }
  if (parsed.display) {
    if (['auto', 'truecolor', 'none'].includes(parsed.display.color))
      defaults.display.color = parsed.display.color;
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
            ttl_minutes: typeof src.ttl_minutes === 'number' ? src.ttl_minutes : 60
          };
        }
      }
    }
  }
  if (parsed.community) {
    if (typeof parsed.community.default_board === 'string')
      defaults.community.default_board = parsed.community.default_board;
    if (typeof parsed.community.collapse_flag_threshold === 'number')
      defaults.community.collapse_flag_threshold = parsed.community.collapse_flag_threshold;
  }
  return defaults;
}

function cloneSettings(s: AgoraSettings): AgoraSettings {
  return {
    account: { ...s.account },
    display: { ...s.display },
    news: {
      sources: Object.fromEntries(Object.entries(s.news.sources).map(([k, v]) => [k, { ...v }])),
      feeds: [...(s.news.feeds ?? [])]
    },
    community: { ...s.community }
  };
}
