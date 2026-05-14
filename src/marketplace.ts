import type { Package, Workflow, Discussion, Tutorial } from './types.js';
import {
  samplePackages,
  sampleWorkflows,
  sampleDiscussions,
  sampleTutorials,
  trendingTags
} from './data.js';
import type { OpenCodeConfig } from './config.js';

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
  installable: boolean;
  reason?: string;
  config: OpenCodeConfig;
  commands: string[];
  notes: string[];
}

const CONFIG_SCHEMA = 'https://opencode.ai/config.json';

export function getMarketplaceItems(): MarketplaceItem[] {
  return [
    ...samplePackages.map((pkg) => ({ ...pkg, kind: 'package' as const })),
    ...sampleWorkflows.map((workflow) => ({
      ...workflow,
      kind: 'workflow' as const,
      category: 'workflow' as const,
      installs: workflow.forks
    }))
  ];
}

export function searchMarketplaceItems(options: SearchOptions = {}): MarketplaceItem[] {
  const query = normalize(options.query || '');
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit);

  const results = getMarketplaceItems()
    .filter((item) => matchesCategory(item, category))
    .filter((item) => matchesQuery(item, query))
    .sort(sortByRelevance(query));

  return limit ? results.slice(0, limit) : results;
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
    .sort((a, b) => b.stars - a.stars)
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
  existingConfig: OpenCodeConfig = {}
): InstallPlan {
  const installKind = getInstallKind(item);

  if (installKind === 'unsupported') {
    return {
      item,
      installable: false,
      reason: `${item.name} does not expose an install target yet`,
      config: normalizeConfig(existingConfig),
      commands: [],
      notes: ['This item can be browsed, but Agora cannot install it automatically yet.']
    };
  }

  const config = buildOpenCodeConfig([item], existingConfig);
  const commands =
    installKind === 'mcp' && item.kind === 'package' && item.npmPackage
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
    installable: true,
    config,
    commands,
    notes
  };
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

export function getInstallKind(item: MarketplaceItem): 'mcp' | 'workflow' | 'unsupported' {
  if (item.kind === 'package' && item.npmPackage) return 'mcp';
  if (item.kind === 'workflow') return 'workflow';
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

function sortByRelevance(query: string) {
  return (a: MarketplaceItem, b: MarketplaceItem) => {
    if (!query) return b.stars - a.stars;

    const aName = normalize(a.name).includes(query) ? 1 : 0;
    const bName = normalize(b.name).includes(query) ? 1 : 0;

    if (aName !== bName) return bName - aName;
    return b.stars - a.stars;
  };
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
