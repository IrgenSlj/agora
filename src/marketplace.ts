import { join } from 'node:path';
import type { Package, Permissions, Workflow, Discussion, Tutorial } from './types.js';
import {
  samplePackages,
  sampleWorkflows,
  sampleDiscussions,
  sampleTutorials,
  trendingTags
} from './data.js';
import type { OpenCodeConfig } from './config.js';
import { detectAgoraDataDir } from './state.js';
import { isHubCacheStale, readHubsCache } from './hubs/cache.js';
import type { HubItem, InstallKind } from './hubs/types.js';

export type MarketplaceCategory = 'all' | 'package' | 'mcp' | 'prompt' | 'workflow' | 'skill';
export type MarketplaceItemType = 'package' | 'workflow';

export type PackageMarketplaceItem = Package & {
  kind: 'package';
};

export type WorkflowMarketplaceItem = Workflow & {
  kind: 'workflow';
  category: 'workflow';
  installs: number;
  npmPackage?: never;
  version?: never;
};

export type MarketplaceItem = PackageMarketplaceItem | WorkflowMarketplaceItem;

export interface SearchOptions {
  query?: string;
  category?: string;
  limit?: number;
  sortBy?: 'relevance' | 'stars' | 'installs' | 'name' | 'updated';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface TutorialSearchOptions {
  query?: string;
  level?: string;
  limit?: number;
}

export interface FindOptions {
  type?: string;
}

export interface InstallPlan {
  item: MarketplaceItem;
  kind: InstallKind | 'workflow' | 'unsupported';
  installable: boolean;
  reason?: string;
  config: OpenCodeConfig;
  commands: string[];
  notes: string[];
  cloneTarget?: string;
  postInstallHint?: string;
  permissions?: Permissions;
}

export function renderPermissionLines(perms: Permissions | undefined): string[] {
  if (!perms) return ['Permissions  none declared'];
  const rows: string[] = [];
  if (perms.fs?.length) rows.push(`  fs    ${perms.fs.join(', ')}`);
  if (perms.net?.length) rows.push(`  net   ${perms.net.join(', ')}`);
  if (perms.exec?.length) rows.push(`  exec  ${perms.exec.join(', ')}`);
  if (rows.length === 0) return ['Permissions  none declared'];
  return ['Permissions', ...rows];
}

export function hasPermissions(perms: Permissions | undefined): boolean {
  if (!perms) return false;
  return Boolean(perms.fs?.length || perms.net?.length || perms.exec?.length);
}

export function describePermissionGlob(value: string): string {
  if (value === '*') return 'unrestricted';
  if (value === './**/*') return 'anywhere under the current working directory';
  if (value.includes('~/.config/agora')) return 'agora config directory only';
  return '';
}

const CONFIG_SCHEMA = 'https://opencode.ai/config.json';

function hubItemToPackage(item: HubItem): PackageMarketplaceItem {
  return {
    kind: 'package',
    id: item.id,
    name: item.name,
    description: item.description,
    author: item.author,
    version: item.version,
    category: item.category,
    tags: item.tags,
    stars: item.stars,
    installs: item.installs,
    repository: item.repository,
    npmPackage: item.npmPackage,
    createdAt: item.createdAt,
    pricing: item.pricing
  };
}

// Memoize for 30s. The curated catalog is a static import; the hub cache
// changes only when scripts/refresh-hubs.ts runs. TUI pages call this once
// per render — without memoization that's 60+ catalog rebuilds per minute on
// arrow-key navigation with AGORA_LIVE_HUBS=1.
let _memo: { at: number; envFlag: string; items: MarketplaceItem[] } | null = null;
const MEMO_TTL_MS = 30_000;

let _warnedEmpty = false;
let _warnedStale = false;

export function clearMarketplaceItemsCache(): void {
  _memo = null;
  _warnedEmpty = false;
  _warnedStale = false;
}

export function getMarketplaceItems(): MarketplaceItem[] {
  const envFlag = process.env.AGORA_LIVE_HUBS ?? '';
  if (_memo && _memo.envFlag === envFlag && Date.now() - _memo.at < MEMO_TTL_MS) {
    return _memo.items;
  }

  const curated: MarketplaceItem[] = [
    ...samplePackages.map((pkg) => ({ ...pkg, kind: 'package' as const })),
    ...sampleWorkflows.map((workflow) => ({
      ...workflow,
      kind: 'workflow' as const,
      category: 'workflow' as const,
      installs: workflow.forks
    }))
  ];

  let items: MarketplaceItem[] = curated;

  if (envFlag === '1') {
    const dataDir = detectAgoraDataDir({ env: process.env });
    const hubItems = readHubsCache(dataDir);
    if (hubItems.length === 0 && !_warnedEmpty) {
      console.warn('AGORA_LIVE_HUBS=1 but hub cache is empty. Run: bun scripts/refresh-hubs.ts');
      _warnedEmpty = true;
    } else if (hubItems.length > 0 && isHubCacheStale(hubItems, 60, new Date()) && !_warnedStale) {
      console.warn('AGORA_LIVE_HUBS=1 but hub cache is stale (>60min). Run: bun scripts/refresh-hubs.ts');
      _warnedStale = true;
    }
    if (hubItems.length > 0) {
      const curatedIds = new Set(curated.map((i) => i.id));
      const live = hubItems.filter((item) => !curatedIds.has(item.id)).map(hubItemToPackage);
      items = [...curated, ...live];
    }
  }

  _memo = { at: Date.now(), envFlag, items };
  return items;
}

export function searchMarketplaceItems(options: SearchOptions = {}): MarketplaceItem[] {
  const query = normalize(options.query || '');
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit);
  const sortBy = options.sortBy || 'relevance';
  const sortOrder = options.sortOrder || 'desc';
  const page = options.page || 1;
  const perPage = options.perPage || 0;

  let results = getMarketplaceItems()
    .filter((item) => matchesCategory(item, category))
    .filter((item) => matchesQuery(item, query));

  results.sort(sortMarketplaceItems(sortBy, sortOrder, query));

  if (perPage > 0) {
    const start = (page - 1) * perPage;
    results = results.slice(start, start + perPage);
  } else if (limit) {
    results = results.slice(0, limit);
  }

  return results;
}

export function sortMarketplaceItems(
  sortBy: string,
  sortOrder: 'asc' | 'desc',
  query: string
): (a: MarketplaceItem, b: MarketplaceItem) => number {
  return (a: MarketplaceItem, b: MarketplaceItem) => {
    let cmp: number;

    if (sortBy === 'stars') cmp = a.stars - b.stars;
    else if (sortBy === 'installs') cmp = a.installs - b.installs;
    else if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortBy === 'updated') cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    else cmp = relevanceScore(a, b, query);

    return sortOrder === 'desc' ? -cmp : cmp;
  };
}

function relevanceScore(a: MarketplaceItem, b: MarketplaceItem, query: string): number {
  if (!query) return compareByPopularity(a, b);
  const aName = normalize(a.name).includes(query) ? 1 : 0;
  const bName = normalize(b.name).includes(query) ? 1 : 0;
  if (aName !== bName) return bName - aName;
  return compareByPopularity(a, b);
}

export function findMarketplaceItem(id: string, options: FindOptions = {}): MarketplaceItem | null {
  const target = normalize(id);
  const type = normalize(options.type || '');
  const items = getMarketplaceItems().filter((item) => {
    if (type === 'package') return item.kind === 'package';
    if (type === 'workflow') return item.kind === 'workflow';
    return true;
  });

  const exactId = items.find((item) => normalize(item.id) === target);
  if (exactId) return exactId;

  const exactName = items.find((item) => normalize(item.name) === target);
  if (exactName) return exactName;

  const substringMatches = items.filter(
    (item) => normalize(item.id).includes(target) || normalize(item.name).includes(target)
  );
  return substringMatches.length === 1 ? substringMatches[0] : null;
}

export function getTrendingItems(options: SearchOptions = {}): MarketplaceItem[] {
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit) || 5;

  return getMarketplaceItems()
    .filter((item) => matchesCategory(item, category))
    .sort((a, b) => b.installs - a.installs || b.stars - a.stars || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function getDiscussions(category = 'all', query = ''): Discussion[] {
  const normalizedCategory = normalize(category);
  const normalizedQuery = normalize(query);

  return sampleDiscussions
    .filter(
      (discussion) => normalizedCategory === 'all' || discussion.category === normalizedCategory
    )
    .filter((discussion) => {
      if (!normalizedQuery) return true;
      return normalize(`${discussion.title} ${discussion.content} ${discussion.author}`).includes(
        normalizedQuery
      );
    })
    .sort((a, b) => b.stars - a.stars);
}

export function getTutorials(options: TutorialSearchOptions = {}): Tutorial[] {
  const query = normalize(options.query || '');
  const level = normalizeTutorialLevel(options.level || 'all');
  const limit = normalizeLimit(options.limit);

  const tutorials = sampleTutorials
    .filter((tutorial) => level === 'all' || tutorial.level === level)
    .filter((tutorial) => matchesTutorialQuery(tutorial, query))
    .sort((a, b) => a.title.localeCompare(b.title));

  return limit ? tutorials.slice(0, limit) : tutorials;
}

export function findTutorial(id: string): Tutorial | null {
  const target = normalize(id);
  return (
    sampleTutorials.find((tutorial) => normalize(tutorial.id) === target) ||
    sampleTutorials.find((tutorial) => normalize(tutorial.title) === target) ||
    sampleTutorials.find((tutorial) => normalize(tutorial.id).includes(target)) ||
    sampleTutorials.find((tutorial) => normalize(tutorial.title).includes(target)) ||
    null
  );
}

export function getTrendingTags(limit = 8): string[] {
  return trendingTags.slice(0, limit);
}

export function createInstallPlan(
  item: MarketplaceItem,
  existingConfig: OpenCodeConfig = {},
  opts?: { dataDir?: string; aiInstallHint?: string }
): InstallPlan {
  const installKind = getInstallKind(item);

  const itemPerms = item.kind === 'package' ? item.permissions : undefined;

  if (installKind === 'unsupported') {
    return {
      item,
      kind: 'unsupported',
      installable: false,
      reason: `${item.name} does not expose an install target yet`,
      config: normalizeConfig(existingConfig),
      commands: [],
      notes: ['This item can be browsed, but Agora cannot install it automatically yet.'],
      permissions: itemPerms
    };
  }

  if (installKind === 'git-clone') {
    const repo = (item as any).repository as string;
    // Refuse to clone repos whose URL contains shell metacharacters — the
    // runner uses execSync(cmd, ...) and we shouldn't interpolate untrusted
    // strings into shell. Accept only http(s):// or git@host:owner/repo forms.
    const looksClean = /^(https?:\/\/[\w.\-/:?#=&%+~]+|git@[\w.\-]+:[\w.\-/]+)$/.test(repo);
    if (!looksClean) {
      return {
        item,
        kind: 'git-clone',
        installable: false,
        reason: 'repository URL contains characters not permitted by the install runner',
        config: normalizeConfig(existingConfig),
        commands: [],
        notes: [],
        permissions: itemPerms
      };
    }
    const repoMatch = repo.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    const slug = repoMatch
      ? `${repoMatch[1]}-${repoMatch[2]}`
      : item.id.replace(/[^a-z0-9-]/gi, '-');
    const cloneTarget = opts?.dataDir
      ? join(opts.dataDir, 'installed', slug)
      : `~/.config/agora/installed/${slug}`;
    const cloneCommand = `git clone ${repo} ${cloneTarget}`;
    const notes = opts?.dataDir
      ? [`Repository will be cloned to ${cloneTarget}.`]
      : [`Repository will be cloned to ${cloneTarget} (path resolved at install time).`];
    return {
      item,
      kind: 'git-clone',
      installable: true,
      config: normalizeConfig(existingConfig),
      commands: [cloneCommand],
      notes,
      cloneTarget,
      postInstallHint: opts?.aiInstallHint,
      permissions: itemPerms
    };
  }

  if (installKind === 'package-install') {
    const commands: string[] = [];
    return {
      item,
      kind: 'package-install',
      installable: true,
      config: normalizeConfig(existingConfig),
      commands,
      notes: ['Package will be installed via the appropriate package manager.'],
      permissions: itemPerms
    };
  }

  // mcp-config-patch and workflow
  const config = buildOpenCodeConfig([item], existingConfig);
  const commands =
    installKind === 'mcp-config-patch' && item.kind === 'package' && item.npmPackage
      ? [`npm install -g ${item.npmPackage}`]
      : [];
  const notes =
    installKind === 'workflow'
      ? [
          `Workflow will be registered as plugin ${workflowPluginName(item as WorkflowMarketplaceItem)}.`
        ]
      : ['MCP server will be added to the mcp config.'];

  return {
    item,
    kind: installKind,
    installable: true,
    config,
    commands,
    notes,
    permissions: itemPerms
  };
}

export function extractPostInstallHint(readme: string): string | undefined {
  const headingRe = /^##\s+(installation|install|setup|getting started)\s*$/im;
  const match = headingRe.exec(readme);
  if (!match) return undefined;
  const afterHeading = readme.slice(match.index + match[0].length);
  const lines = afterHeading.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) break; // stop at next heading
    if (trimmed) {
      return trimmed.slice(0, 120);
    }
  }
  return undefined;
}

export function buildOpenCodeConfig(
  items: MarketplaceItem[],
  existingConfig: OpenCodeConfig = {}
): OpenCodeConfig {
  const normalized = normalizeConfig(existingConfig);
  const mcp = { ...(normalized.mcp || {}) };
  const plugin = new Set(normalized.plugin || []);

  for (const item of items) {
    if (item.kind === 'package' && item.npmPackage) {
      mcp[item.id] = {
        type: 'local',
        command: ['npx', item.npmPackage],
        enabled: true
      };
    }

    if (item.kind === 'workflow') {
      plugin.add(workflowPluginName(item));
    }
  }

  return {
    $schema: normalized.$schema || CONFIG_SCHEMA,
    mcp,
    plugin: Array.from(plugin)
  };
}

export function getInstallKind(item: MarketplaceItem): InstallKind | 'workflow' | 'unsupported' {
  if (item.kind === 'workflow') return 'workflow';
  if (item.kind === 'package' && item.npmPackage) return 'mcp-config-patch';
  if (
    item.kind === 'package' &&
    item.repository &&
    ((item as any).source === 'github' || (item as any).source === 'hf')
  )
    return 'git-clone';
  // package-install reserved for future pypi/cargo detection — unreachable in v1
  return 'unsupported';
}

export function workflowPluginName(workflow: WorkflowMarketplaceItem): string {
  return workflow.id.replace(/^wf-/, 'skill-');
}

export function normalizeCategory(category: string): MarketplaceCategory {
  const normalized = normalize(category);
  if (normalized === 'packages') return 'package';
  if (normalized === 'workflows') return 'workflow';
  if (['all', 'package', 'mcp', 'prompt', 'workflow', 'skill'].includes(normalized)) {
    return normalized as MarketplaceCategory;
  }
  return 'all';
}

export function similarItems(
  id: string,
  options?: { limit?: number; type?: MarketplaceItemType }
): MarketplaceItem[] {
  const target = findMarketplaceItem(id, options ? { type: options.type } : undefined);
  if (!target) return [];

  const allItems = getMarketplaceItems().filter((item) => {
    if (options?.type === 'package' && item.kind !== 'package') return false;
    if (options?.type === 'workflow' && item.kind !== 'workflow') return false;
    return item.id !== target.id;
  });

  if (allItems.length === 0) return [];

  const N = allItems.length + 1;
  const tagDf = new Map<string, number>();
  const allTagged = [...allItems, target];
  for (const item of allTagged) {
    const seen = new Set<string>();
    for (const tag of item.tags ?? []) {
      if (!seen.has(tag)) {
        tagDf.set(tag, (tagDf.get(tag) ?? 0) + 1);
        seen.add(tag);
      }
    }
  }

  const tagWeight = (tag: string): number => {
    const df = tagDf.get(tag) ?? 1;
    return Math.log((N + 1) / (1 + df));
  };

  const targetTags = new Set(target.tags ?? []);
  const scored = allItems.map((item) => {
    const itemTags = new Set(item.tags ?? []);
    let intersection = 0;
    let union = 0;
    const allUnique = new Set([...targetTags, ...itemTags]);
    for (const tag of allUnique) {
      const w = tagWeight(tag);
      if (targetTags.has(tag) && itemTags.has(tag)) intersection += w;
      union += w;
    }
    const sim = union > 0 ? intersection / union : 0;
    return { item, sim };
  });

  scored.sort((a, b) => {
    if (b.sim !== a.sim) return b.sim - a.sim;
    return (b.item.installs ?? 0) - (a.item.installs ?? 0);
  });

  const limit = Math.max(1, options?.limit ?? 5);
  return scored.slice(0, limit).map((s) => s.item);
}

export function normalizeTutorialLevel(level: string): Tutorial['level'] | 'all' {
  const normalized = normalize(level);
  if (normalized === 'beginner' || normalized === 'intermediate' || normalized === 'advanced') {
    return normalized;
  }
  return 'all';
}

function matchesCategory(item: MarketplaceItem, category: MarketplaceCategory): boolean {
  if (category === 'all') return true;
  if (category === 'package') return item.kind === 'package';
  if (category === 'workflow') return item.kind === 'workflow' || item.category === 'workflow';
  return item.category === category;
}

function matchesQuery(item: MarketplaceItem, query: string): boolean {
  if (!query) return true;

  const searchable = [
    item.id,
    item.name,
    item.description,
    item.author,
    item.category,
    ...item.tags
  ].join(' ');

  return normalize(searchable).includes(query);
}

function matchesTutorialQuery(tutorial: Tutorial, query: string): boolean {
  if (!query) return true;

  const searchable = [
    tutorial.id,
    tutorial.title,
    tutorial.description,
    tutorial.level,
    tutorial.duration,
    ...tutorial.steps.flatMap((step) => [step.title, step.content, step.code || ''])
  ].join(' ');

  return normalize(searchable).includes(query);
}

/**
 * Ranks items by real per-item popularity. `installs` (npm downloads / workflow
 * forks) is the primary signal because `stars` is repo-level — every package in
 * the modelcontextprotocol/servers monorepo shares one star count, which would
 * otherwise tie the entire official set.
 */
function compareByPopularity(a: MarketplaceItem, b: MarketplaceItem): number {
  if (a.installs !== b.installs) return a.installs - b.installs;
  if (a.stars !== b.stars) return a.stars - b.stars;
  return a.name.localeCompare(b.name);
}

function normalizeConfig(config: OpenCodeConfig): OpenCodeConfig {
  return {
    $schema: config.$schema || CONFIG_SCHEMA,
    mcp: config.mcp || {},
    plugin: config.plugin || []
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLimit(limit?: number): number | undefined {
  if (!limit || !Number.isFinite(limit) || limit < 1) return undefined;
  return Math.floor(limit);
}
