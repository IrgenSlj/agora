import type { Package, Permissions, Workflow } from '../types.js';

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
  kind: import('../hubs/types.js').InstallKind | 'workflow' | 'unsupported';
  installable: boolean;
  reason?: string;
  config: import('../config.js').OpenCodeConfig;
  commands: string[];
  notes: string[];
  cloneTarget?: string;
  postInstallHint?: string;
  permissions?: Permissions;
}
