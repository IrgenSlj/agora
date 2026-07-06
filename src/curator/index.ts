import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWriteFile } from '../atomic-write.js';
import { FREE_MODELS } from '../cli/commands/chat.js';
import { samplePackages } from '../data.js';
import { fetchHfRepoMetadata, fetchRepoMetadata } from '../hubs/enrichment.js';
import { searchGithub } from '../hubs/github.js';
import { searchHuggingFace } from '../hubs/huggingface.js';
import type { HubItem } from '../hubs/types.js';
import {
  buildOpencodeRunArgs,
  isOpencodeAvailable as isOpencodeBinaryAvailable,
  spawnOpencode
} from '../opencode-exec.js';

const MAX_AI_ITEMS = 50;
const MAX_RETRIES = 3;

export interface CuratedPackage {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  tags: string[];
  stars: number;
  installs: number;
  repository: string;
  npmPackage?: string;
  createdAt: string;
  pricing: { kind: 'free' };
  permissions?: { fs?: string[]; net?: string[]; exec?: string[] };
  installHint?: string;
  aiVerifiedAt: string;
}

export function curationCachePath(dataDir: string): string {
  return join(dataDir, 'curation-cache.json');
}

export function curationStatePath(dataDir: string): string {
  return join(dataDir, 'curation-state.json');
}

export function readCuratedCache(dataDir: string): CuratedPackage[] {
  const path = curationCachePath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as CuratedPackage[];
    return [];
  } catch {
    return [];
  }
}

export function writeCuratedCache(dataDir: string, items: CuratedPackage[]): void {
  mkdirSync(dataDir, { recursive: true });
  const sorted = [...items].sort((a, b) => b.stars - a.stars);
  atomicWriteFile(curationCachePath(dataDir), JSON.stringify(sorted, null, 2));
}

export function getCuratedItems(dataDir: string): CuratedPackage[] {
  const cached = readCuratedCache(dataDir);
  if (cached.length > 0) return cached;
  return [];
}

/**
 * Normalises a repository URL for deduplication:
 * lower-cases, strips trailing slashes and a trailing ".git".
 */
export function normaliseRepo(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

/**
 * Filters out HubItem candidates whose id OR repository already exists in the
 * bundled hand-curated catalog (src/data.ts samplePackages).
 * Pure function — no I/O.
 */
export function filterBundledDuplicates(candidates: HubItem[]): HubItem[] {
  const bundledIds = new Set(samplePackages.map((p) => p.id.toLowerCase()));
  const bundledRepos = new Set(
    samplePackages.filter((p) => p.repository).map((p) => normaliseRepo(p.repository!))
  );
  return candidates.filter((item) => {
    if (bundledIds.has(item.id.toLowerCase())) return false;
    if (item.repository && bundledRepos.has(normaliseRepo(item.repository))) return false;
    return true;
  });
}

/**
 * Deduplicates an array of items by `id`, keeping the first occurrence.
 * Pure function — no I/O.
 */
export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * Returns true if the given ISO timestamp is older than `staleDays` days.
 * Pure function — `now` defaults to the current date (injectable for tests).
 */
export function isStale(aiVerifiedAt: string, staleDays: number, now?: Date): boolean {
  const verifiedMs = new Date(aiVerifiedAt).getTime();
  const nowMs = (now ?? new Date()).getTime();
  const staleLimitMs = staleDays * 24 * 60 * 60 * 1000;
  return nowMs - verifiedMs >= staleLimitMs;
}

/**
 * Runs `fn` over `items` with at most `limit` concurrent executions.
 * Preserves input order in the returned array.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Returns curation status without running discovery or verification.
 */
export interface CurationStatus {
  count: number;
  lastRunAt: string | null;
  source: 'ai' | 'bundled';
  lastRunStats?: RunStats;
  lastRunMode?: 'incremental' | 'refresh' | 'force';
}

interface CurationState {
  lastRunAt: string;
  mode: 'incremental' | 'refresh' | 'force';
  stats: RunStats;
}

interface RunStats {
  discovered: number;
  skippedBundled: number;
  reused: number;
  verified: number;
  rejected: number;
  fetchFailed: number;
  aiFailed: number;
}

export function curationStatus(dataDir: string): CurationStatus {
  const cached = readCuratedCache(dataDir);
  const base: CurationStatus =
    cached.length === 0
      ? { count: samplePackages.length, lastRunAt: null, source: 'bundled' }
      : (() => {
          const dates = cached
            .map((p) => p.aiVerifiedAt)
            .filter(Boolean)
            .sort()
            .reverse();
          const lastRunAt = dates[0] ?? null;
          return { count: cached.length, lastRunAt, source: 'ai' as const };
        })();

  const statePath = curationStatePath(dataDir);
  if (existsSync(statePath)) {
    try {
      const raw = readFileSync(statePath, 'utf8');
      const state = JSON.parse(raw) as CurationState;
      base.lastRunStats = state.stats;
      base.lastRunMode = state.mode;
    } catch {
      // state file is optional — ignore parse errors
    }
  }

  return base;
}

/**
 * Returns true if the `opencode` binary is available on PATH.
 */
export function isOpencodeAvailable(): boolean {
  return isOpencodeBinaryAvailable();
}

interface VerifyResult {
  isGenuine: boolean;
  category: 'mcp' | 'prompt' | 'workflow' | 'skill';
  description: string;
  permissions: { fs?: string[]; net?: string[]; exec?: string[] };
  installHint: string | null;
  tags: string[];
}

async function callOpencodeModel(prompt: string, retries = MAX_RETRIES): Promise<string | null> {
  const model = FREE_MODELS[0];

  for (let attempt = 0; attempt < retries; attempt++) {
    const result = await new Promise<string | null>((resolve) => {
      let child: ReturnType<typeof spawnOpencode>;
      try {
        child = spawnOpencode(buildOpencodeRunArgs({ model, prompt }), {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch {
        resolve(null);
        return;
      }
      let response = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 45000);

      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'text' && ev.part?.text) response += ev.part.text;
          } catch {
            // skip
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
    if (result) return result;
  }
  return null;
}

function buildVerifyPrompt(name: string, readme: string): string {
  const maxChars = 10000;
  const trimmed =
    readme.length > maxChars ? readme.slice(0, maxChars) + '\n...(truncated)' : readme;
  return `<system>
You are analyzing an open-source repository README. Determine if this is a genuine MCP server, AI prompt library, workflow template, or OpenCode skill.

Return ONLY valid JSON with these fields:
- "isGenuine": boolean (true if it's clearly a real MCP server, prompt collection, workflow template, or skill; false if it's unrelated, a tutorial, a framework, or a library that happens to use MCP)
- "category": one of "mcp" (Model Context Protocol server), "prompt" (AI prompt templates), "workflow" (agent workflow template), "skill" (OpenCode/openhands skill)
- "description": max 20 words, concise factual summary
- "permissions": object with optional "fs" (string[] of filesystem paths), "net" (string[] of network permissions), "exec" (string[] of executable permissions); empty object if none found
- "installHint": the primary install command/method as a single line, or null if unclear
- "tags": array of 2-5 relevant lowercase tags

Examples of genuine items:
- A repo with topic "mcp-server" that implements the MCP protocol with tools/resources
- A collection of prompt templates for Claude/GPT
- A workflow .mdc/.prompt file collection for agent coding workflows
- A skill package for OpenCode with an opencode.json

Examples of non-genuine items:
- A general-purpose library that happens to have an "mcp" topic tag
- A tutorial or guide about MCP
- A framework for building MCP servers (not a server itself)
- A project that is archived or clearly experimental

<user>
Repo: ${name}

README:
${trimmed}`;
}

function parseVerifyResponse(text: string): VerifyResult | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    const parsed = JSON.parse(cleaned);
    if (typeof parsed.isGenuine !== 'boolean') return null;
    return {
      isGenuine: parsed.isGenuine,
      category: parsed.category || 'mcp',
      description: parsed.description || '',
      permissions: parsed.permissions || {},
      installHint: parsed.installHint || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : []
    };
  } catch {
    return null;
  }
}

async function verifyWithAi(name: string, readme: string): Promise<VerifyResult | null> {
  const prompt = buildVerifyPrompt(name, readme);
  const response = await callOpencodeModel(prompt);
  if (!response) return null;
  return parseVerifyResponse(response);
}

// Discriminated result type for processCandidate
type CandidateOutcome =
  | { kind: 'verified'; pkg: CuratedPackage }
  | { kind: 'rejected' }
  | { kind: 'fetch-failed' }
  | { kind: 'ai-unavailable' };

async function processCandidate(hubItem: HubItem): Promise<CandidateOutcome> {
  const repoId = hubItem.id.startsWith('gh:') ? hubItem.id.slice(3) : hubItem.id;
  const isHf = hubItem.source === 'hf';

  let readme: string;
  let version: string;

  if (isHf) {
    const meta = await fetchHfRepoMetadata(repoId);
    if (!meta) return { kind: 'fetch-failed' };
    readme = meta.readme;
    version = meta.version;
  } else {
    const meta = await fetchRepoMetadata(repoId);
    if (!meta) return { kind: 'fetch-failed' };
    readme = meta.readme;
    version = meta.commitSha;
  }

  const result = await verifyWithAi(hubItem.name, readme);
  if (!result) return { kind: 'ai-unavailable' };
  if (!result.isGenuine) return { kind: 'rejected' };

  const published: CuratedPackage = {
    id: hubItem.id,
    name: hubItem.name,
    description: result.description || hubItem.description,
    author: hubItem.author,
    version,
    category: result.category,
    tags: result.tags.length > 0 ? result.tags : hubItem.tags,
    stars: hubItem.stars,
    installs: hubItem.installs,
    repository: hubItem.repository,
    npmPackage: hubItem.npmPackage,
    createdAt: hubItem.createdAt,
    pricing: { kind: 'free' },
    permissions: Object.keys(result.permissions).length > 0 ? result.permissions : undefined,
    installHint: result.installHint ?? undefined,
    aiVerifiedAt: new Date().toISOString()
  };

  return { kind: 'verified', pkg: published };
}

export interface CurateAllOptions {
  limit?: number;
  /** @deprecated prefer `mode: 'force'` */
  force?: boolean;
  mode?: 'incremental' | 'refresh' | 'force';
  staleDays?: number;
  concurrency?: number;
  onProgress?: (message: string) => void;
}

export async function curateAll(
  dataDir: string,
  opts: CurateAllOptions = {}
): Promise<CuratedPackage[]> {
  const log = opts.onProgress || ((msg: string) => console.log(msg));
  const limit = opts.limit || MAX_AI_ITEMS;
  const concurrency = opts.concurrency || 4;
  const staleDays = opts.staleDays ?? 30;

  // Resolve mode: explicit `mode` wins; fall back to `force` boolean for compat.
  const mode: 'incremental' | 'refresh' | 'force' =
    opts.mode ?? (opts.force ? 'force' : 'incremental');

  const cached = readCuratedCache(dataDir);
  const cachedById = new Map<string, CuratedPackage>(cached.map((p) => [p.id, p]));

  // Incremental mode: if cache is non-empty and no new candidates, short-circuit early.
  // (Discovery is still needed for refresh/force modes.)
  if (mode === 'incremental' && cached.length > 0) {
    log(`Found ${cached.length} cached curated items (use --force to re-curate)`);
    return cached;
  }

  if (!isOpencodeAvailable()) {
    const msg =
      'AI verification unavailable: `opencode` not found on PATH. ' +
      'Install opencode (https://opencode.ai) or run with cached results.';
    log(msg);
    return cached;
  }

  log('Discovering candidates from GitHub and HuggingFace...');
  const rawCandidates = await discoverCandidates();
  log(`Found ${rawCandidates.length} candidate items`);

  const candidates = filterBundledDuplicates(rawCandidates);
  const skippedBundled = rawCandidates.length - candidates.length;
  if (skippedBundled > 0) {
    log(`Skipped ${skippedBundled} items already in the bundled catalog`);
  }

  const todo = candidates.slice(0, limit);

  // Determine which items to skip vs. process based on mode.
  // Incremental: skip items already in cache by id.
  // Refresh: skip items in cache whose aiVerifiedAt is fresh (not stale).
  // Force: process everything.
  //
  // Resumption logic: because incremental cache writes persist partial
  // progress, an interrupted --refresh/--force run resumes correctly on
  // re-run: items already written are present in the cache with a fresh
  // aiVerifiedAt, so they are treated as fresh and reused automatically.
  const reusedItems: CuratedPackage[] = [];
  const itemsToProcess: HubItem[] = [];

  for (const item of todo) {
    const existing = cachedById.get(item.id);
    if (!existing) {
      itemsToProcess.push(item);
      continue;
    }
    if (mode === 'force') {
      itemsToProcess.push(item);
      continue;
    }
    if (mode === 'refresh' && isStale(existing.aiVerifiedAt, staleDays)) {
      itemsToProcess.push(item);
      continue;
    }
    // Incremental: already cached (non-empty cache short-circuited above,
    // but if somehow we're here, reuse it).
    // Refresh: item is fresh, reuse without an AI call.
    reusedItems.push(existing);
  }

  log(`Reusing ${reusedItems.length} fresh cached items, verifying ${itemsToProcess.length} items`);

  const stats: RunStats = {
    discovered: rawCandidates.length,
    skippedBundled,
    reused: reusedItems.length,
    verified: 0,
    rejected: 0,
    fetchFailed: 0,
    aiFailed: 0
  };

  // Shared completion counter for periodic cache writes.
  let completions = 0;

  // Cached items not in this run's todo list (they were never candidates this
  // run — preserve them verbatim).
  const todoIds = new Set(todo.map((t) => t.id));
  const untouchedCached = cached.filter((c) => !todoIds.has(c.id));

  // Accumulate verified results; we write incrementally so slot array up-front.
  const verifiedResults: CuratedPackage[] = [];

  await mapWithConcurrency(itemsToProcess, concurrency, async (item, _idx) => {
    const label = `${item.name}`;
    log(`${label} — verifying...`);

    let outcome: CandidateOutcome;
    try {
      outcome = await processCandidate(item);
    } catch (err) {
      // Per-item exceptions must never abort the batch.
      log(`${label} ✗ unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      stats.fetchFailed += 1;
      return;
    }

    switch (outcome.kind) {
      case 'verified':
        verifiedResults.push(outcome.pkg);
        stats.verified += 1;
        log(`${label} ✓ verified as ${outcome.pkg.category}`);
        break;
      case 'rejected':
        stats.rejected += 1;
        log(`${label} ✗ rejected (not a genuine item)`);
        break;
      case 'fetch-failed':
        stats.fetchFailed += 1;
        log(`${label} ✗ fetch failed`);
        break;
      case 'ai-unavailable':
        stats.aiFailed += 1;
        log(`${label} ✗ AI unavailable or parse error`);
        break;
    }

    completions += 1;
    // Periodic incremental write every 5 completions.
    if (completions % 5 === 0) {
      const partial = dedupeById([...untouchedCached, ...reusedItems, ...verifiedResults]);
      writeCuratedCache(dataDir, partial);
    }
  });

  // Final merged result: untouched cached + reused fresh + newly verified.
  const finalItems = dedupeById([...untouchedCached, ...reusedItems, ...verifiedResults]);
  writeCuratedCache(dataDir, finalItems);

  log(
    `\nDone. ${stats.verified} new items verified, ${stats.reused} reused, ${stats.rejected} rejected, ${stats.fetchFailed} fetch-failed, ${stats.aiFailed} ai-failed`
  );
  log(`Total in cache: ${finalItems.length} items`);

  // Persist run-state for --status
  const state: CurationState = {
    lastRunAt: new Date().toISOString(),
    mode,
    stats
  };
  atomicWriteFile(curationStatePath(dataDir), JSON.stringify(state, null, 2));

  return finalItems;
}

export async function discoverCandidates(): Promise<HubItem[]> {
  const [ghItems, hfItems] = await Promise.all([searchGithub(), searchHuggingFace()]);

  const seen = new Set<string>();
  const items: HubItem[] = [];
  for (const item of [...ghItems, ...hfItems]) {
    if (!seen.has(item.repository)) {
      seen.add(item.repository);
      items.push(item);
    }
  }
  items.sort((a, b) => b.stars - a.stars);
  return items;
}
