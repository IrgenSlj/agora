import type {
  SourceOptions,
  SourceResult,
  PackageMarketplaceItem,
  WorkflowMarketplaceItem,
  Discussion,
  Tutorial,
  TutorialStep,
  ApiReview,
  ApiProfile
} from './types.js';

/* ── HTTP utilities ── */

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

export function buildUrl(options: SourceOptions, path: string): string {
  return new URL(path, ensureTrailingSlash(options.apiUrl || '')).toString();
}

export async function fetchWithTimeout(
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

export async function responseError(response: Response, path: string): Promise<string> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (body?.error) return `API returned ${response.status} for ${path}: ${body.error}`;
  } catch {
    // Use generic status message.
  }
  return `API returned ${response.status} for ${path}`;
}

export async function requestJson<T>(
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

export async function requestNullable<T>(
  options: SourceOptions,
  path: string
): Promise<T | null> {
  const response = await fetchWithTimeout(options, buildUrl(options, path));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(await responseError(response, path));
  }
  return response.json() as Promise<T>;
}

/* ── Normalizers ── */

export function normalizeCategory(category?: string): string {
  if (!category) return 'all';
  const c = category.trim().toLowerCase();
  return c === 'packages' ? 'package' : c;
}

export function normalizeTutorialLevel(level?: string): string {
  if (!level) return 'all';
  const c = level.trim().toLowerCase();
  return c === 'beginner' || c === 'intermediate' || c === 'advanced' ? c : 'all';
}

export function normalizeSortBy(sortBy?: string): string {
  const valid = ['relevance', 'stars', 'installs', 'name', 'updated'];
  return sortBy && valid.includes(sortBy) ? sortBy : 'relevance';
}

export function normalizeSortOrder(order?: string): string {
  return order === 'asc' ? 'asc' : 'desc';
}

export function normalizeLimit(limit?: number): number | undefined {
  if (!limit || !Number.isFinite(limit) || limit < 1) return undefined;
  return Math.floor(limit);
}

export function normalizePackageCategory(category?: string): PackageMarketplaceItem['category'] {
  const normalized = normalizeCategory(category || 'mcp');
  return ['mcp', 'prompt', 'workflow', 'skill'].includes(normalized)
    ? (normalized as PackageMarketplaceItem['category'])
    : 'mcp';
}

export function normalizeDiscussionCategory(category?: string): Discussion['category'] {
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

export function isPackageCategory(category: string): boolean {
  return category === 'mcp' || category === 'prompt' || category === 'skill';
}

export function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ── Utility: parse helpers ── */

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String);
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags as string);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // Fall back to comma-separated.
  }
  return (tags as string)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function parseTutorialSteps(steps: unknown): TutorialStep[] {
  if (Array.isArray(steps)) return steps.map(normalizeTutorialStep).filter(Boolean) as TutorialStep[];
  if (!steps) return [];
  try {
    const parsed = JSON.parse(steps as string);
    if (Array.isArray(parsed)) return parsed.map(normalizeTutorialStep).filter(Boolean) as TutorialStep[];
  } catch {
    // Fall back to plain text step.
  }
  return [{ title: 'Tutorial', content: steps as string }];
}

function normalizeTutorialStep(step: unknown): TutorialStep | null {
  if (!step || typeof step !== 'object') return null;
  const candidate = step as Partial<TutorialStep>;
  const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title : 'Step';
  const content = typeof candidate.content === 'string' ? candidate.content : '';
  const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : undefined;
  if (!content) return null;
  return { title, content, code };
}

/* ── Mappers ── */

export function mapPackage(pkg: Record<string, unknown>): PackageMarketplaceItem {
  return {
    id: pkg.id as string,
    name: pkg.name as string,
    description: (pkg.description as string) || '',
    author: (pkg.author as string) || 'unknown',
    version: (pkg.version as string) || '0.0.0',
    category: normalizePackageCategory(pkg.category as string | undefined),
    tags: parseTags(pkg.tags),
    stars: Number(pkg.stars || 0),
    installs: Number(pkg.installs || 0),
    repository: (pkg.repository as string) || undefined,
    npmPackage: (pkg.npmPackage || pkg.npm_package) as string | undefined,
    createdAt: (pkg.createdAt || pkg.created_at) as string || '',
    kind: 'package'
  };
}

export function mapWorkflow(workflow: Record<string, unknown>): WorkflowMarketplaceItem {
  return {
    id: workflow.id as string,
    name: workflow.name as string,
    description: (workflow.description as string) || '',
    author: (workflow.author as string) || 'unknown',
    prompt: (workflow.prompt as string) || '',
    model: (workflow.model as string) || undefined,
    tags: parseTags(workflow.tags),
    stars: Number(workflow.stars || 0),
    forks: Number(workflow.forks || 0),
    createdAt: (workflow.createdAt || workflow.created_at) as string || '',
    category: 'workflow',
    installs: Number(workflow.forks || 0),
    kind: 'workflow'
  };
}

export function mapDiscussion(discussion: Record<string, unknown>): Discussion {
  return {
    id: discussion.id as string,
    title: discussion.title as string,
    content: (discussion.content as string) || '',
    author: (discussion.author as string) || 'unknown',
    category: normalizeDiscussionCategory(discussion.category as string | undefined),
    replies: Number(discussion.replies ?? discussion.reply_count ?? 0),
    stars: Number(discussion.stars || 0),
    createdAt: (discussion.createdAt || discussion.created_at) as string || ''
  };
}

export function mapTutorial(tutorial: Record<string, unknown>): Tutorial {
  const level = normalizeTutorialLevel(tutorial.level as string || 'beginner');
  return {
    id: tutorial.id as string,
    title: tutorial.title as string,
    description: (tutorial.description as string) || '',
    level: level === 'all' ? 'beginner' : level as 'beginner' | 'intermediate' | 'advanced',
    duration: (tutorial.duration as string) || '',
    steps: parseTutorialSteps(tutorial.steps)
  };
}

export function mapReview(value: unknown): ApiReview {
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

export function mapProfile(user: Record<string, unknown>): ApiProfile {
  const username = String(user.username || '');
  return {
    id: String(user.id || username),
    username,
    displayName: String(user.displayName || user.display_name || username),
    bio: (user.bio as string) || undefined,
    avatarUrl: (user.avatarUrl || user.avatar_url) as string | undefined,
    packages: Number(user.packages ?? user.package_count ?? 0),
    workflows: Number(user.workflows ?? user.workflow_count ?? 0),
    discussions: Number(user.discussions ?? user.discussion_count ?? 0),
    reputation: Number(user.reputation ?? 0),
    joinedAt: String(user.joinedAt || user.createdAt || user.created_at || '')
  };
}

export function findTutorialInList(tutorials: Tutorial[], id: string): Tutorial | null {
  const target = id.trim().toLowerCase();
  return (
    tutorials.find((t) => t.id.toLowerCase() === target) ||
    tutorials.find((t) => t.title.toLowerCase() === target) ||
    tutorials.find((t) => t.id.toLowerCase().includes(target)) ||
    tutorials.find((t) => t.title.toLowerCase().includes(target)) ||
    null
  );
}

/* ── Source result builders ── */

export function api<T>(data: T, options: SourceOptions): SourceResult<T> {
  return { source: 'api', apiUrl: options.apiUrl, data };
}

export function offline<T>(data: T, error?: unknown): SourceResult<T> {
  return {
    source: 'offline',
    data,
    fallbackReason: error ? errorToMessage(error) : undefined
  };
}
