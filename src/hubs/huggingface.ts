import type { HubItem } from './types.js';

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HfSearchOptions {
  fetcher?: FetchLike;
  signal?: AbortSignal;
  now?: Date;
  // No token — HF public API is unauth-friendly with generous limits
}

// Categories we care about, mapped to HF API endpoints
export const HF_QUERIES = [
  { endpoint: 'models', filter: 'text-generation', limit: 50 },
  { endpoint: 'models', filter: 'feature-extraction', limit: 25 },
  { endpoint: 'models', filter: 'text2text-generation', limit: 25 },
  { endpoint: 'datasets', filter: 'instruction-tuning', limit: 25 },
  { endpoint: 'spaces', filter: 'chatbot', limit: 25 }
];

export interface RawHfItem {
  id: string; // "owner/name"
  modelId?: string; // for models
  author?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  pipeline_tag?: string;
  library_name?: string;
  createdAt?: string;
  lastModified?: string;
  private?: boolean;
  // datasets/spaces have similar but not identical shapes — use a permissive type
}

export async function searchHuggingFace(opts: HfSearchOptions = {}): Promise<HubItem[]> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const now = opts.now ?? new Date();
  const fetchedAt = now.toISOString();

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'agora-cli'
  };

  const byId = new Map<string, { raw: RawHfItem; endpoint: string }>();

  for (const query of HF_QUERIES) {
    const url = `https://huggingface.co/api/${query.endpoint}?filter=${query.filter}&sort=downloads&direction=-1&limit=${query.limit}`;
    try {
      const res = await fetcher(url, { headers, signal: opts.signal });
      if (!res.ok) continue;
      const json = (await res.json()) as RawHfItem[];
      for (const item of json ?? []) {
        if (!item.id || !item.id.includes('/')) continue;
        if (!byId.has(item.id)) {
          byId.set(item.id, { raw: item, endpoint: query.endpoint });
        }
      }
    } catch {
      continue; // graceful; we have cache fallback
    }
  }

  const items: HubItem[] = [];
  for (const { raw, endpoint } of byId.values()) {
    if (!passesHf(raw, now)) continue;
    items.push(toHubItem(raw, endpoint, fetchedAt));
  }

  // Sort by downloads (installs) descending
  items.sort((a, b) => b.installs - a.installs);

  return items;
}

function passesHf(item: RawHfItem, _now: Date): boolean {
  if (item.private) return false;
  if (!item.id || !item.author) return false;
  const downloads = item.downloads ?? 0;
  const likes = item.likes ?? 0;
  // Lower threshold than GitHub stars — HF downloads are noisier
  if (downloads < 100 && likes < 5) return false;
  return true;
}

function toHubItem(raw: RawHfItem, endpoint: string, fetchedAt: string): HubItem {
  const [author, name] = raw.id.split('/');
  return {
    id: `hf:${raw.id}`,
    source: 'hf',
    name: name ?? raw.id,
    description: raw.pipeline_tag
      ? `${raw.pipeline_tag} ${endpoint.slice(0, -1)}` // 'text-generation model'
      : endpoint.slice(0, -1), // fallback
    author: author ?? raw.author ?? 'unknown',
    version: 'main',
    category: categorizeHf(endpoint, raw),
    tags: Array.from(
      new Set([...(raw.tags ?? []), raw.pipeline_tag, raw.library_name].filter(Boolean) as string[])
    ),
    stars: raw.likes ?? 0,
    installs: raw.downloads ?? 0,
    repository: `https://huggingface.co/${raw.id}`,
    createdAt: raw.createdAt ?? fetchedAt,
    pricing: { kind: 'free' },
    fetchedAt,
    pushedAt: raw.lastModified ?? fetchedAt,
    license: null, // HF licenses are buried — leave null for v1
    topics: raw.tags ?? []
  };
}

function categorizeHf(_endpoint: string, _raw: RawHfItem): HubItem['category'] {
  // Models/datasets/spaces all map to 'workflow' for v1 — they're not MCP/skills/prompts.
  // Refine later if needed.
  return 'workflow';
}
