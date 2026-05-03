import type { Discussion } from './types.js';
import {
  findMarketplaceItem,
  getDiscussions,
  getTrendingItems,
  normalizeCategory,
  searchMarketplaceItems,
  type MarketplaceCategory,
  type MarketplaceItem,
  type PackageMarketplaceItem,
  type WorkflowMarketplaceItem
} from './marketplace.js';

export type SourceName = 'api' | 'offline';
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SourceOptions {
  useApi?: boolean;
  apiUrl?: string;
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export interface SearchSourceOptions extends SourceOptions {
  query?: string;
  category?: string;
  limit?: number;
}

export interface FindSourceOptions extends SourceOptions {
  id: string;
  type?: string;
}

export interface DiscussionSourceOptions extends SourceOptions {
  category?: string;
  query?: string;
}

export interface SourceResult<T> {
  source: SourceName;
  data: T;
  apiUrl?: string;
  fallbackReason?: string;
}

interface ApiPackage {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  category?: string;
  tags?: string[] | string | null;
  stars?: number;
  installs?: number;
  repository?: string;
  npmPackage?: string;
  npm_package?: string;
  createdAt?: string;
  created_at?: string;
}

interface ApiWorkflow {
  id: string;
  name: string;
  description?: string;
  author?: string;
  prompt?: string;
  model?: string;
  tags?: string[] | string | null;
  stars?: number;
  forks?: number;
  createdAt?: string;
  created_at?: string;
}

interface ApiDiscussion {
  id: string;
  title: string;
  content?: string;
  author?: string;
  category?: string;
  replies?: number;
  reply_count?: number;
  stars?: number;
  createdAt?: string;
  created_at?: string;
}

export async function searchMarketplaceSource(options: SearchSourceOptions = {}): Promise<SourceResult<MarketplaceItem[]>> {
  if (!shouldUseApi(options)) {
    return offline(searchMarketplaceItems(options));
  }

  try {
    const data = await searchApi(options);
    return api(data, options);
  } catch (error) {
    return offline(searchMarketplaceItems(options), error);
  }
}

export async function findMarketplaceSource(options: FindSourceOptions): Promise<SourceResult<MarketplaceItem | null>> {
  if (!shouldUseApi(options)) {
    return offline(findMarketplaceItem(options.id, { type: options.type }));
  }

  try {
    const data = await findApi(options);
    return api(data, options);
  } catch (error) {
    return offline(findMarketplaceItem(options.id, { type: options.type }), error);
  }
}

export async function trendingMarketplaceSource(options: SearchSourceOptions = {}): Promise<SourceResult<MarketplaceItem[]>> {
  if (!shouldUseApi(options)) {
    return offline(getTrendingItems(options));
  }

  try {
    const data = await trendingApi(options);
    return api(data, options);
  } catch (error) {
    return offline(getTrendingItems(options), error);
  }
}

export async function discussionsSource(options: DiscussionSourceOptions = {}): Promise<SourceResult<Discussion[]>> {
  if (!shouldUseApi(options)) {
    return offline(getDiscussions(options.category, options.query));
  }

  try {
    const data = await discussionsApi(options);
    return api(data, options);
  } catch (error) {
    return offline(getDiscussions(options.category, options.query), error);
  }
}

function shouldUseApi(options: SourceOptions): boolean {
  return Boolean(options.useApi && options.apiUrl);
}

async function searchApi(options: SearchSourceOptions): Promise<MarketplaceItem[]> {
  const query = options.query || '';
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit) || 10;
  const tasks: Promise<MarketplaceItem[]>[] = [];

  if (category === 'all' || category === 'package' || isPackageCategory(category)) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (isPackageCategory(category)) params.set('category', category);
    tasks.push(requestJson<{ packages?: ApiPackage[] }>(options, `/api/packages?${params}`)
      .then((payload) => (payload.packages || []).map(mapPackage)));
  }

  if (category === 'all' || category === 'workflow') {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    tasks.push(requestJson<{ workflows?: ApiWorkflow[] }>(options, `/api/workflows?${params}`)
      .then((payload) => (payload.workflows || []).map(mapWorkflow)));
  }

  const results = (await Promise.all(tasks)).flat().sort((a, b) => b.stars - a.stars);
  return results.slice(0, limit);
}

async function findApi(options: FindSourceOptions): Promise<MarketplaceItem | null> {
  const type = options.type?.toLowerCase();

  if (type === 'package') {
    const pkg = await requestNullable<{ package?: ApiPackage }>(options, `/api/packages/${encodeURIComponent(options.id)}`);
    return pkg?.package ? mapPackage(pkg.package) : null;
  }

  if (type === 'workflow') {
    const workflow = await requestNullable<{ workflow?: ApiWorkflow }>(options, `/api/workflows/${encodeURIComponent(options.id)}`);
    return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
  }

  const pkg = await requestNullable<{ package?: ApiPackage }>(options, `/api/packages/${encodeURIComponent(options.id)}`);
  if (pkg?.package) return mapPackage(pkg.package);

  const workflow = await requestNullable<{ workflow?: ApiWorkflow }>(options, `/api/workflows/${encodeURIComponent(options.id)}`);
  return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
}

async function trendingApi(options: SearchSourceOptions): Promise<MarketplaceItem[]> {
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit) || 5;
  const payload = await requestJson<{ packages?: ApiPackage[]; workflows?: ApiWorkflow[] }>(options, '/api/trending');
  const packages = (payload.packages || []).map(mapPackage);
  const workflows = (payload.workflows || []).map(mapWorkflow);

  return [...packages, ...workflows]
    .filter((item) => category === 'all' || item.category === category || (category === 'package' && item.kind === 'package'))
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit);
}

async function discussionsApi(options: DiscussionSourceOptions): Promise<Discussion[]> {
  const category = options.category && options.category !== 'all' ? options.category : '';
  const params = category ? `?${new URLSearchParams({ category })}` : '';
  const payload = await requestJson<{ discussions?: ApiDiscussion[] }>(options, `/api/discussions${params}`);
  const query = (options.query || '').trim().toLowerCase();

  return (payload.discussions || [])
    .map(mapDiscussion)
    .filter((discussion) => {
      if (!query) return true;
      return `${discussion.title} ${discussion.content} ${discussion.author}`.toLowerCase().includes(query);
    });
}

async function requestJson<T>(options: SourceOptions, path: string): Promise<T> {
  const response = await fetchWithTimeout(options, buildUrl(options, path));
  if (!response.ok) {
    throw new Error(`API returned ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

async function requestNullable<T>(options: SourceOptions, path: string): Promise<T | null> {
  const response = await fetchWithTimeout(options, buildUrl(options, path));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`API returned ${response.status} for ${path}`);
  }
  return response.json() as Promise<T>;
}

async function fetchWithTimeout(options: SourceOptions, url: string): Promise<Response> {
  const fetcher = options.fetcher || fetch;
  const timeoutMs = options.timeoutMs || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetcher(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`API request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function buildUrl(options: SourceOptions, path: string): string {
  return new URL(path, ensureTrailingSlash(options.apiUrl || '')).toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function mapPackage(pkg: ApiPackage): PackageMarketplaceItem {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description || '',
    author: pkg.author || 'unknown',
    version: pkg.version || '0.0.0',
    category: normalizePackageCategory(pkg.category),
    tags: parseTags(pkg.tags),
    stars: Number(pkg.stars || 0),
    installs: Number(pkg.installs || 0),
    repository: pkg.repository || undefined,
    npmPackage: pkg.npmPackage || pkg.npm_package || undefined,
    createdAt: pkg.createdAt || pkg.created_at || '',
    kind: 'package'
  };
}

function mapWorkflow(workflow: ApiWorkflow): WorkflowMarketplaceItem {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description || '',
    author: workflow.author || 'unknown',
    prompt: workflow.prompt || '',
    model: workflow.model || undefined,
    tags: parseTags(workflow.tags),
    stars: Number(workflow.stars || 0),
    forks: Number(workflow.forks || 0),
    createdAt: workflow.createdAt || workflow.created_at || '',
    category: 'workflow',
    installs: Number(workflow.forks || 0),
    kind: 'workflow'
  };
}

function mapDiscussion(discussion: ApiDiscussion): Discussion {
  return {
    id: discussion.id,
    title: discussion.title,
    content: discussion.content || '',
    author: discussion.author || 'unknown',
    category: normalizeDiscussionCategory(discussion.category),
    replies: Number(discussion.replies ?? discussion.reply_count ?? 0),
    stars: Number(discussion.stars || 0),
    createdAt: discussion.createdAt || discussion.created_at || ''
  };
}

function parseTags(tags: ApiPackage['tags']): string[] {
  if (Array.isArray(tags)) return tags;
  if (!tags) return [];

  try {
    const parsed = JSON.parse(tags);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Fall back to comma-separated tags.
  }

  return tags.split(',').map((tag) => tag.trim()).filter(Boolean);
}

function normalizePackageCategory(category?: string): PackageMarketplaceItem['category'] {
  const normalized = normalizeCategory(category || 'mcp');
  return ['mcp', 'prompt', 'workflow', 'skill'].includes(normalized) ? normalized as PackageMarketplaceItem['category'] : 'mcp';
}

function normalizeDiscussionCategory(category?: string): Discussion['category'] {
  if (category === 'question' || category === 'idea' || category === 'showcase' || category === 'discussion') {
    return category;
  }
  return 'discussion';
}

function isPackageCategory(category: MarketplaceCategory): boolean {
  return category === 'mcp' || category === 'prompt' || category === 'skill';
}

function normalizeLimit(limit?: number): number | undefined {
  if (!limit || !Number.isFinite(limit) || limit < 1) return undefined;
  return Math.floor(limit);
}

function api<T>(data: T, options: SourceOptions): SourceResult<T> {
  return {
    source: 'api',
    apiUrl: options.apiUrl,
    data
  };
}

function offline<T>(data: T, error?: unknown): SourceResult<T> {
  return {
    source: 'offline',
    data,
    fallbackReason: error ? errorToMessage(error) : undefined
  };
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
