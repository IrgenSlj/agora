import type { SourceResult, SourceOptions, SearchSourceOptions, MarketplaceItem } from './types.js';
import {
  requestJson,
  requestNullable,
  normalizeCategory,
  normalizeLimit,
  isPackageCategory,
  mapPackage,
  mapWorkflow,
  api,
  offline
} from './internal.js';
import { searchMarketplaceItems, findMarketplaceItem, getTrendingItems } from '../marketplace.js';

/* ── API helpers ── */

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
      requestJson<{ packages?: Record<string, unknown>[] }>(
        options,
        `/api/packages?${params}`
      ).then((payload) => (payload.packages || []).map(mapPackage))
    );
  }

  if (category === 'all' || category === 'workflow') {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    tasks.push(
      requestJson<{ workflows?: Record<string, unknown>[] }>(
        options,
        `/api/workflows?${params}`
      ).then((payload) => (payload.workflows || []).map(mapWorkflow))
    );
  }

  const settled = await Promise.allSettled(tasks);
  const fulfilled = settled.filter((r) => r.status === 'fulfilled');
  if (fulfilled.length === 0 && settled.length > 0) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }
  const arrays: MarketplaceItem[][] = settled.map((r): MarketplaceItem[] =>
    r.status === 'fulfilled' ? r.value : []
  );
  const results = arrays.flat().sort((a, b) => b.stars - a.stars);
  return results.slice(0, limit);
}

async function findApi(
  options: SourceOptions & { id: string; type?: string }
): Promise<MarketplaceItem | null> {
  const type = options.type?.toLowerCase();

  if (type === 'package') {
    const pkg = await requestNullable<{ package?: Record<string, unknown> }>(
      options,
      `/api/packages/${encodeURIComponent(options.id)}`
    );
    return pkg?.package ? mapPackage(pkg.package) : null;
  }

  if (type === 'workflow') {
    const workflow = await requestNullable<{ workflow?: Record<string, unknown> }>(
      options,
      `/api/workflows/${encodeURIComponent(options.id)}`
    );
    return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
  }

  const pkg = await requestNullable<{ package?: Record<string, unknown> }>(
    options,
    `/api/packages/${encodeURIComponent(options.id)}`
  );
  if (pkg?.package) return mapPackage(pkg.package);

  const workflow = await requestNullable<{ workflow?: Record<string, unknown> }>(
    options,
    `/api/workflows/${encodeURIComponent(options.id)}`
  );
  return workflow?.workflow ? mapWorkflow(workflow.workflow) : null;
}

async function trendingApi(
  options: SourceOptions & { category?: string; limit?: number }
): Promise<MarketplaceItem[]> {
  const category = normalizeCategory(options.category || 'all');
  const limit = normalizeLimit(options.limit) || 5;
  const payload = await requestJson<{
    packages?: Record<string, unknown>[];
    workflows?: Record<string, unknown>[];
  }>(options, '/api/trending');
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

/* ── Exported sources ── */

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
  options: SourceOptions & { id: string; type?: string }
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
  options: SourceOptions & { category?: string; limit?: number } = {}
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
