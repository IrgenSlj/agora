import type { Package, Permissions } from '../types.js';

export type MarketplaceCategory = 'all' | 'package' | 'mcp' | 'prompt' | 'skill' | 'other';

/**
 * The bundled catalog carries exactly one artifact shape.
 *
 * There used to be a second, `workflow` — bundled prompt templates with
 * invented star and fork counts, no repository, no digest, and no upstream to
 * refresh from. They surfaced in `agora search` with fabricated engagement
 * numbers, which is the one thing this product says it never does. Brief D8
 * locks two artifact kinds (`mcp-server`, `agent-skill`) and neither is that.
 *
 * `MarketplaceItem` stays a named type rather than an alias for `Package`
 * because callers narrow on `kind`, and `agent-skill` will want its own branch
 * here when it lands as a first-class bundled shape.
 */
export type PackageMarketplaceItem = Package & {
  kind: 'package';
};

export type MarketplaceItem = PackageMarketplaceItem;

export interface SearchOptions {
  query?: string;
  category?: string;
  limit?: number;
  sortBy?: 'relevance' | 'stars' | 'installs' | 'name' | 'updated';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

export interface FindOptions {
  type?: string;
}

export interface InstallPlan {
  item: MarketplaceItem;
  kind: import('../hubs/types.js').InstallKind | 'unsupported';
  installable: boolean;
  reason?: string;
  config: import('../config.js').OpenCodeConfig;
  commands: string[];
  notes: string[];
  cloneTarget?: string;
  postInstallHint?: string;
  permissions?: Permissions;
}
