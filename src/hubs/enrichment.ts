import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { FREE_MODELS } from '../cli/commands/chat.js';
import { extractPostInstallHint } from '../marketplace.js';

export interface EnrichmentEntry {
  repoId: string;
  commitSha: string;
  description?: string;
  installHint?: string;
  fetchedAt: string;
}

export interface EnrichmentStore {
  [key: string]: EnrichmentEntry;
}

export function enrichmentPath(dataDir: string): string {
  return join(dataDir, 'hubs-enrichment.json');
}

export function readEnrichmentStore(dataDir: string): EnrichmentStore {
  const path = enrichmentPath(dataDir);
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as EnrichmentStore;
  } catch {
    return {};
  }
}

export function writeEnrichmentStore(dataDir: string, store: EnrichmentStore): void {
  mkdirSync(dataDir, { recursive: true });
  const path = enrichmentPath(dataDir);
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

export function getEnrichment(
  store: EnrichmentStore,
  repoId: string,
  commitSha: string
): EnrichmentEntry | undefined {
  return store[`${repoId}@${commitSha}`];
}

export function setEnrichment(store: EnrichmentStore, entry: EnrichmentEntry): EnrichmentStore {
  return { ...store, [`${entry.repoId}@${entry.commitSha}`]: entry };
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchRepoMetadata(
  repoId: string,
  opts: { fetcher?: FetchLike; signal?: AbortSignal; token?: string } = {}
): Promise<{ commitSha: string; readme: string } | null> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const token = opts.token ?? process.env.AGORA_GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agora-cli'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const commitsUrl = `https://api.github.com/repos/${repoId}/commits?per_page=1`;
    const commitsRes = await fetcher(commitsUrl, { headers, signal: opts.signal });
    if (!commitsRes.ok) return null;
    const commitsJson = (await commitsRes.json()) as Array<{ sha: string }>;
    const commitSha = commitsJson[0]?.sha;
    if (!commitSha) return null;

    const readmeUrl = `https://api.github.com/repos/${repoId}/readme`;
    const readmeRes = await fetcher(readmeUrl, { headers, signal: opts.signal });
    if (!readmeRes.ok) return null;
    const readmeJson = (await readmeRes.json()) as { content?: string; encoding?: string };
    if (!readmeJson.content) return null;
    const readme = Buffer.from(readmeJson.content, 'base64').toString('utf8');

    return { commitSha, readme };
  } catch {
    return null;
  }
}

export async function fetchHfRepoMetadata(
  repoId: string,
  opts: { fetcher?: FetchLike; signal?: AbortSignal } = {}
): Promise<{ version: string; readme: string } | null> {
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'agora-cli'
  };

  const cardRes = await fetcher(`https://huggingface.co/api/models/${repoId}`, {
    headers,
    signal: opts.signal
  });
  if (!cardRes.ok) return null;
  const card = (await cardRes.json()) as { lastModified?: string };
  const version = card.lastModified;
  if (!version) return null;

  const endpoints = ['models', 'datasets', 'spaces'] as const;
  let readme: string | null = null;
  for (const ep of endpoints) {
    const url =
      ep === 'models'
        ? `https://huggingface.co/${repoId}/raw/main/README.md`
        : `https://huggingface.co/${ep}/${repoId}/raw/main/README.md`;
    const res = await fetcher(url, { headers, signal: opts.signal });
    if (res.ok) {
      readme = await res.text();
      break;
    }
  }
  if (!readme) return null;

  const maxChars = 8000;
  const trimmed = readme.length > maxChars ? readme.slice(0, maxChars) + '\n...(truncated)' : readme;
  return { version, readme: trimmed };
}

async function callOpencode(prompt: string): Promise<string | null> {
  const model = FREE_MODELS[0];
  const modelArg = model.includes('/') ? model : `opencode/${model}`;

  return new Promise((resolve) => {
    const child = spawn('opencode', ['run', '--format', 'json', '--model', modelArg, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    let response = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 30000);

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        try {
          const ev = JSON.parse(line);
          if (ev.type === 'text' && ev.part?.text) response += ev.part.text;
        } catch {
          /* skip */
        }
      }
    });

    child.on('close', () => {
      clearTimeout(timer);
      resolve(response || null);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

export async function generateDescription(
  readme: string,
  opencodeFn?: (prompt: string) => Promise<string | null>
): Promise<string | null> {
  const maxChars = 8000;
  const trimmed =
    readme.length > maxChars ? readme.slice(0, maxChars) + '\n...(truncated)' : readme;
  const prompt = `<system>\nYou are summarizing an open-source repository's README. Write ONE sentence (max 20 words) describing what this repo does. Be concrete; no marketing language.\n<user>\n${trimmed}`;
  const result = await (opencodeFn ?? callOpencode)(prompt);
  if (!result) return null;
  const trimmedResult = result.trim();
  return trimmedResult || null;
}

export async function generateInstallHint(
  readme: string,
  opencodeFn?: (prompt: string) => Promise<string | null>
): Promise<string | null> {
  const maxChars = 8000;
  const trimmed =
    readme.length > maxChars ? readme.slice(0, maxChars) + '\n...(truncated)' : readme;
  const prompt = `<system>\nExtract the single install command or step from this README. Return ONE line, max 100 chars. If unclear, return 'UNKNOWN'. Do not add commentary.\n<user>\n${trimmed}`;
  const result = await (opencodeFn ?? callOpencode)(prompt);
  if (!result) return null;
  const trimmedResult = result.trim();
  if (!trimmedResult || trimmedResult.toUpperCase() === 'UNKNOWN') return null;
  return trimmedResult;
}

export async function enrichItem(
  repoId: string,
  dataDir: string,
  opts: { fetcher?: FetchLike; token?: string; opencode?: (prompt: string) => Promise<string | null> } = {}
): Promise<EnrichmentEntry | null> {
  const store = readEnrichmentStore(dataDir);

  // Check if we already have a cached entry for this repoId
  const existingEntry = Object.values(store).find((e) => e.repoId === repoId);

  // Fetch the latest commit sha (cheap call)
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const token = opts.token ?? process.env.AGORA_GITHUB_TOKEN;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agora-cli'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let latestSha: string | null = null;
  try {
    const commitsUrl = `https://api.github.com/repos/${repoId}/commits?per_page=1`;
    const commitsRes = await fetcher(commitsUrl, { headers });
    if (commitsRes.ok) {
      const commitsJson = (await commitsRes.json()) as Array<{ sha: string }>;
      latestSha = commitsJson[0]?.sha ?? null;
    }
  } catch {
    // If we can't fetch SHA, return cached if available
    if (existingEntry) return existingEntry;
    return null;
  }

  if (!latestSha) {
    if (existingEntry) return existingEntry;
    return null;
  }

  // Cache hit: sha matches
  if (existingEntry && existingEntry.commitSha === latestSha) {
    return existingEntry;
  }

  // Need to fetch full metadata
  const meta = await fetchRepoMetadata(repoId, { fetcher, token });
  if (!meta) return null;

  const [description, aiHint] = await Promise.all([
    generateDescription(meta.readme, opts.opencode),
    generateInstallHint(meta.readme, opts.opencode)
  ]);

  const installHint = aiHint ?? extractPostInstallHint(meta.readme);

  const entry: EnrichmentEntry = {
    repoId,
    commitSha: meta.commitSha,
    description: description ?? undefined,
    installHint: installHint ?? undefined,
    fetchedAt: new Date().toISOString()
  };

  const updated = setEnrichment(store, entry);
  writeEnrichmentStore(dataDir, updated);

  return entry;
}

export async function enrichHfItem(
  repoId: string,
  dataDir: string,
  opts: { fetcher?: FetchLike; opencode?: (prompt: string) => Promise<string | null> } = {}
): Promise<EnrichmentEntry | null> {
  const storeRepoId = `hf:${repoId}`;
  const store = readEnrichmentStore(dataDir);
  const existingEntry = Object.values(store).find((e) => e.repoId === storeRepoId);

  const meta = await fetchHfRepoMetadata(repoId, { fetcher: opts.fetcher });
  if (!meta) {
    return existingEntry ?? null;
  }

  if (existingEntry && existingEntry.commitSha === meta.version) {
    return existingEntry;
  }

  const [description, installHint] = await Promise.all([
    generateDescription(meta.readme, opts.opencode),
    generateInstallHint(meta.readme, opts.opencode)
  ]);

  const entry: EnrichmentEntry = {
    repoId: storeRepoId,
    commitSha: meta.version,
    description: description ?? undefined,
    installHint: installHint ?? undefined,
    fetchedAt: new Date().toISOString()
  };

  const updated = setEnrichment(store, entry);
  writeEnrichmentStore(dataDir, updated);

  return entry;
}
