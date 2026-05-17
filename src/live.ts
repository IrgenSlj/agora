import type { Discussion, Tutorial, TutorialStep } from './types.js';
import {
  findMarketplaceItem,
  findTutorial,
  getDiscussions,
  getTutorials,
  getTrendingItems,
  normalizeCategory,
  normalizeTutorialLevel,
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
  token?: string;
  fetcher?: FetchLike;
  timeoutMs?: number;
}

export interface SearchSourceOptions extends SourceOptions {
  query?: string;
  category?: string;
  limit?: number;
  sortBy?: 'relevance' | 'stars' | 'installs' | 'name' | 'updated';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface FindSourceOptions extends SourceOptions {
  id: string;
  type?: string;
}

export interface DiscussionSourceOptions extends SourceOptions {
  category?: string;
  query?: string;
}

export interface TutorialSourceOptions extends SourceOptions {
  query?: string;
  level?: string;
  limit?: number;
}

export interface FindTutorialSourceOptions extends SourceOptions {
  id: string;
}

export interface SourceResult<T> {
  source: SourceName;
  data: T;
  apiUrl?: string;
  fallbackReason?: string;
}

export interface PublishPackageInput {
  id?: string;
  name: string;
  description: string;
  version?: string;
  category?: string;
  tags?: string[];
  repository?: string;
  npmPackage?: string;
}

export interface PublishWorkflowInput {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tags?: string[];
}

export interface ReviewInput {
  itemId: string;
  itemType: 'package' | 'workflow';
  rating: number;
  content: string;
}

export interface DiscussionInput {
  title: string;
  content: string;
  category?: string;
}

export interface ApiReview {
  id: string;
  itemId: string;
  itemType: 'package' | 'workflow';
  author: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface ApiProfile {
  id: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  packages: number;
  workflows: number;
  discussions: number;
  joinedAt: string;
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

interface ApiTutorial {
  id: string;
  title: string;
  description?: string;
  level?: string;
  duration?: string;
  steps?: TutorialStep[] | string | null;
  createdAt?: string;
  created_at?: string;
}

interface ApiUser {
  id?: string;
  username?: string;
  displayName?: string;
  display_name?: string;
  bio?: string | null;
  avatarUrl?: string;
  avatar_url?: string;
  packages?: number;
  package_count?: number;
  workflows?: number;
  workflow_count?: number;
  discussions?: number;
  discussion_count?: number;
  joinedAt?: string;
  createdAt?: string;
  created_at?: string;
}

export async function searchMarketplaceSource(
  options: SearchSourceOptions = {}
): Promise<SourceResult<MarketplaceItem[]>> {
  if (!shouldUseApi(options)) {
    return offline(
      searchMarketplaceItems({
        query: options.query,
        category: options.category,
        limit: options.limit,
        sortBy: options.sortBy,
        sortOrder: options.sortOrder,
        page: options.page,
        perPage: options.perPage
      })
    );
  }

  try {
    const data = await searchApi(options);
    return api(data, options);
  } catch (error) {
    return offline(searchMarketplaceItems(options), error);
  }
}

export async function findMarketplaceSource(
  options: FindSourceOptions
): Promise<SourceResult<MarketplaceItem | null>> {
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

export async function trendingMarketplaceSource(
  options: SearchSourceOptions = {}
): Promise<SourceResult<MarketplaceItem[]>> {
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

export async function discussionsSource(
  options: DiscussionSourceOptions = {}
): Promise<SourceResult<Discussion[]>> {
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

export async function tutorialsSource(
  options: TutorialSourceOptions = {}
): Promise<SourceResult<Tutorial[]>> {
  if (!shouldUseApi(options)) {
    return offline(getTutorials(options));
  }

  try {
    const data = await tutorialsApi(options);
    return api(data, options);
  } catch (error) {
    return offline(getTutorials(options), error);
  }
}

export async function findTutorialSource(
  options: FindTutorialSourceOptions
): Promise<SourceResult<Tutorial | null>> {
  if (!shouldUseApi(options)) {
    return offline(findTutorial(options.id));
  }

  try {
    const tutorials = await tutorialsApi(options);
    return api(findTutorialInList(tutorials, options.id), options);
  } catch (error) {
    return offline(findTutorial(options.id), error);
  }
}

export async function createDiscussionSource(
  options: SourceOptions,
  input: DiscussionInput
): Promise<SourceResult<Discussion>> {
  if (!shouldUseApi(options)) {
    return offline({
      id: `disc-${Date.now()}`,
      title: input.title,
      content: input.content,
      author: 'you',
      category: normalizeDiscussionCategory(input.category),
      replies: 0,
      stars: 0,
      createdAt: new Date().toISOString().slice(0, 10)
    });
  }

  const payload = await requestJson<{ discussion?: ApiDiscussion } & Partial<ApiDiscussion>>(
    options,
    '/api/discussions',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  const discussion = (payload.discussion || payload) as ApiDiscussion;

  if (!discussion.id) {
    throw new Error('API response did not include a discussion');
  }

  return api(mapDiscussion(discussion), options);
}

export async function publishPackageSource(
  options: SourceOptions,
  input: PublishPackageInput
): Promise<SourceResult<MarketplaceItem>> {
  if (!shouldUseApi(options)) {
    return offline(
      mapPackage({
        id: input.id || `pkg-${Date.now()}`,
        name: input.name,
        description: input.description,
        version: input.version || '0.0.0',
        category: input.category,
        tags: input.tags,
        repository: input.repository,
        npmPackage: input.npmPackage
      })
    );
  }

  const payload = await requestJson<{ package?: ApiPackage }>(options, '/api/packages', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      npm_package: input.npmPackage
    })
  });

  if (!payload.package) {
    throw new Error('API response did not include a package');
  }

  return api(mapPackage(payload.package), options);
}

export async function publishWorkflowSource(
  options: SourceOptions,
  input: PublishWorkflowInput
): Promise<SourceResult<MarketplaceItem>> {
  if (!shouldUseApi(options)) {
    return offline(
      mapWorkflow({
        id: input.id || `wf-${Date.now()}`,
        name: input.name,
        description: input.description,
        prompt: input.prompt,
        model: input.model,
        tags: input.tags
      })
    );
  }

  const payload = await requestJson<{ workflow?: ApiWorkflow }>(options, '/api/workflows', {
    method: 'POST',
    body: JSON.stringify(input)
  });

  if (!payload.workflow) {
    throw new Error('API response did not include a workflow');
  }

  return api(mapWorkflow(payload.workflow), options);
}

export async function createReviewSource(
  options: SourceOptions,
  input: ReviewInput
): Promise<SourceResult<ApiReview>> {
  if (!shouldUseApi(options)) {
    return offline({
      id: `rev-${Date.now()}`,
      itemId: input.itemId,
      itemType: input.itemType,
      author: 'you',
      rating: input.rating,
      content: input.content,
      createdAt: new Date().toISOString().slice(0, 10)
    });
  }

  const payload = await requestJson<{ review?: unknown }>(options, '/api/reviews', {
    method: 'POST',
    body: JSON.stringify(input)
  });

  if (!payload.review) {
    throw new Error('API response did not include a review');
  }

  return api(mapReview(payload.review), options);
}

export async function listReviewsSource(
  options: SourceOptions,
  itemId?: string,
  itemType?: string
): Promise<SourceResult<ApiReview[]>> {
  if (!shouldUseApi(options)) {
    return offline([]);
  }

  const params = new URLSearchParams();
  if (itemId) params.set('item_id', itemId);
  if (itemType) params.set('item_type', itemType);

  const suffix = params.size > 0 ? `?${params}` : '';
  const payload = await requestJson<{ reviews?: unknown[] }>(options, `/api/reviews${suffix}`);
  return api((payload.reviews || []).map(mapReview), options);
}

export async function profileSource(
  options: SourceOptions,
  username: string
): Promise<SourceResult<ApiProfile | null>> {
  if (!shouldUseApi(options)) {
    return offline(null);
  }

  const payload = await requestNullable<{ user?: ApiUser }>(
    options,
    `/api/users/${encodeURIComponent(username)}`
  );
  return api(payload?.user ? mapProfile(payload.user) : null, options);
}

export interface MarketplaceFlagInput {
  reason: 'spam' | 'harassment' | 'undisclosed-llm' | 'malicious' | 'other';
  targetType: 'package' | 'workflow';
  notes?: string;
}

export async function flagMarketplaceSource(
  opts: SourceOptions,
  targetId: string,
  input: MarketplaceFlagInput
): Promise<SourceResult<{ success: boolean; deduplicated?: boolean }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return { source: 'offline', data: { success: false }, fallbackReason: 'API required for flag' };
  }
  const fetcher = (opts as any).fetcher ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await fetcher(`${opts.apiUrl}/api/marketplace/flag/${targetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
      body: JSON.stringify(input),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Failed to flag: ${res.status}`);
    const data = (await res.json()) as { success: boolean; deduplicated?: boolean };
    return { source: 'api', apiUrl: opts.apiUrl, data };
  } finally {
    clearTimeout(timer);
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
    tasks.push(
      requestJson<{ packages?: ApiPackage[] }>(options, `/api/packages?${params}`).then((payload) =>
        (payload.packages || []).map(mapPackage)
      )
    );
  }

  if (category === 'all' || category === 'workflow') {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    tasks.push(
      requestJson<{ workflows?: ApiWorkflow[] }>(options, `/api/workflows?${params}`).then(
        (payload) => (payload.workflows || []).map(mapWorkflow)
      )
    );
  }

  const results = (await Promise.all(tasks)).flat().sort((a, b) => b.stars - a.stars);
  return results.slice(0, limit);
}

async function findApi(options: FindSourceOptions): Promise<MarketplaceItem | null> {
  const type = options.type?.toLowerCase();

  if (type === 'package') {
    const pkg = await requestNullable<{ package?: ApiPackage }>(
      options,
      `/api/packages/${encodeURIComponent(options.id)}`
    );
    return pkg?.package ? mapPackage(pkg.package) : null;
  }

  if (type === 'workflow') {
    const workflow = await requestNullable<{ workflow?: ApiWorkflow }>(
      options,
      `/api/workflows/${encodeURIComponent(options.id)}`
    );
    return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
  }

  const pkg = await requestNullable<{ package?: ApiPackage }>(
    options,
    `/api/packages/${encodeURIComponent(options.id)}`
  );
  if (pkg?.package) return mapPackage(pkg.package);

  const workflow = await requestNullable<{ workflow?: ApiWorkflow }>(
    options,
    `/api/workflows/${encodeURIComponent(options.id)}`
  );
  return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
}

async function trendingApi(options: SearchSourceOptions): Promise<MarketplaceItem[]> {
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit) || 5;
  const payload = await requestJson<{ packages?: ApiPackage[]; workflows?: ApiWorkflow[] }>(
    options,
    '/api/trending'
  );
  const packages = (payload.packages || []).map(mapPackage);
  const workflows = (payload.workflows || []).map(mapWorkflow);

  return [...packages, ...workflows]
    .filter(
      (item) =>
        category === 'all' ||
        item.category === category ||
        (category === 'package' && item.kind === 'package')
    )
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit);
}

async function discussionsApi(options: DiscussionSourceOptions): Promise<Discussion[]> {
  const category = options.category && options.category !== 'all' ? options.category : '';
  const params = category ? `?${new URLSearchParams({ category })}` : '';
  const payload = await requestJson<{ discussions?: ApiDiscussion[] }>(
    options,
    `/api/discussions${params}`
  );
  const query = (options.query || '').trim().toLowerCase();

  return (payload.discussions || []).map(mapDiscussion).filter((discussion) => {
    if (!query) return true;
    return `${discussion.title} ${discussion.content} ${discussion.author}`
      .toLowerCase()
      .includes(query);
  });
}

async function tutorialsApi(options: TutorialSourceOptions): Promise<Tutorial[]> {
  const payload = await requestJson<{ tutorials?: ApiTutorial[] }>(options, '/api/tutorials');
  const query = (options.query || '').trim().toLowerCase();
  const level = normalizeTutorialLevel(options.level || 'all');
  const limit = normalizeLimit(options.limit);
  const tutorials = (payload.tutorials || [])
    .map(mapTutorial)
    .filter((tutorial) => level === 'all' || tutorial.level === level)
    .filter((tutorial) => {
      if (!query) return true;
      return `${tutorial.id} ${tutorial.title} ${tutorial.description} ${tutorial.level}`
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  return limit ? tutorials.slice(0, limit) : tutorials;
}

async function requestJson<T>(
  options: SourceOptions,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetchWithTimeout(options, buildUrl(options, path), init);
  if (!response.ok) {
    throw new Error(await responseError(response, path));
  }
  return response.json() as Promise<T>;
}

async function requestNullable<T>(options: SourceOptions, path: string): Promise<T | null> {
  const response = await fetchWithTimeout(options, buildUrl(options, path));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await responseError(response, path));
  }
  return response.json() as Promise<T>;
}

async function fetchWithTimeout(
  options: SourceOptions,
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const fetcher = options.fetcher || fetch;
  const timeoutMs = options.timeoutMs || 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(init.headers);

  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }

  if (options.token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${options.token}`);
  }

  try {
    return await fetcher(url, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`API request timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function responseError(response: Response, path: string): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (body?.error) return `API returned ${response.status} for ${path}: ${body.error}`;
  } catch {
    // Use generic status message.
  }
  return `API returned ${response.status} for ${path}`;
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

function mapTutorial(tutorial: ApiTutorial): Tutorial {
  const level = normalizeTutorialLevel(tutorial.level || 'beginner');

  return {
    id: tutorial.id,
    title: tutorial.title,
    description: tutorial.description || '',
    level: level === 'all' ? 'beginner' : level,
    duration: tutorial.duration || '',
    steps: parseTutorialSteps(tutorial.steps)
  };
}

function mapReview(value: unknown): ApiReview {
  const review = value as Record<string, unknown>;
  const itemType = String(review.itemType || review.item_type || 'package');

  return {
    id: String(review.id || ''),
    itemId: String(review.itemId || review.item_id || ''),
    itemType: itemType === 'workflow' ? 'workflow' : 'package',
    author: String(review.author || 'unknown'),
    rating: Number(review.rating || 0),
    content: String(review.content || ''),
    createdAt: String(review.createdAt || review.created_at || '')
  };
}

function mapProfile(user: ApiUser): ApiProfile {
  const username = String(user.username || '');

  return {
    id: String(user.id || username),
    username,
    displayName: String(user.displayName || user.display_name || username),
    bio: user.bio || undefined,
    avatarUrl: user.avatarUrl || user.avatar_url || undefined,
    packages: Number(user.packages ?? user.package_count ?? 0),
    workflows: Number(user.workflows ?? user.workflow_count ?? 0),
    discussions: Number(user.discussions ?? user.discussion_count ?? 0),
    joinedAt: String(user.joinedAt || user.createdAt || user.created_at || '')
  };
}

function findTutorialInList(tutorials: Tutorial[], id: string): Tutorial | null {
  const target = id.trim().toLowerCase();
  return (
    tutorials.find((tutorial) => tutorial.id.toLowerCase() === target) ||
    tutorials.find((tutorial) => tutorial.title.toLowerCase() === target) ||
    tutorials.find((tutorial) => tutorial.id.toLowerCase().includes(target)) ||
    tutorials.find((tutorial) => tutorial.title.toLowerCase().includes(target)) ||
    null
  );
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

  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseTutorialSteps(steps: ApiTutorial['steps']): TutorialStep[] {
  if (Array.isArray(steps))
    return steps.map(normalizeTutorialStep).filter(Boolean) as TutorialStep[];
  if (!steps) return [];

  try {
    const parsed = JSON.parse(steps);
    if (Array.isArray(parsed))
      return parsed.map(normalizeTutorialStep).filter(Boolean) as TutorialStep[];
  } catch {
    // Fall back to one text step when a backend stores plain text.
  }

  return [
    {
      title: 'Tutorial',
      content: steps
    }
  ];
}

function normalizeTutorialStep(step: unknown): TutorialStep | null {
  if (!step || typeof step !== 'object') return null;
  const candidate = step as Partial<TutorialStep>;
  const title =
    typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : 'Step';
  const content = typeof candidate.content === 'string' ? candidate.content : '';
  const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : undefined;

  if (!content) return null;
  return { title, content, code };
}

function normalizePackageCategory(category?: string): PackageMarketplaceItem['category'] {
  const normalized = normalizeCategory(category || 'mcp');
  return ['mcp', 'prompt', 'workflow', 'skill'].includes(normalized)
    ? (normalized as PackageMarketplaceItem['category'])
    : 'mcp';
}

function normalizeDiscussionCategory(category?: string): Discussion['category'] {
  if (
    category === 'question' ||
    category === 'idea' ||
    category === 'showcase' ||
    category === 'discussion'
  ) {
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
