import type {
  SourceResult,
  SourceOptions,
  MarketplaceItem,
  PublishPackageInput,
  PublishWorkflowInput,
  ReviewInput,
  ApiReview,
  ApiProfile,
  MarketplaceFlagInput
} from './types.js';
import {
  requestJson,
  requestNullable,
  mapPackage,
  mapWorkflow,
  mapReview,
  mapProfile,
  api,
  offline
} from './internal.js';

function shouldUseApi(options: SourceOptions): boolean {
  return Boolean(options.useApi && options.apiUrl);
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

  const payload = await requestJson<{ package?: Record<string, unknown> }>(options, '/api/packages', {
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

  const payload = await requestJson<{ workflow?: Record<string, unknown> }>(options, '/api/workflows', {
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

  const payload = await requestNullable<{ user?: Record<string, unknown> }>(
    options,
    `/api/users/${encodeURIComponent(username)}`
  );
  return api(payload?.user ? mapProfile(payload.user) : null, options);
}

export async function flagMarketplaceSource(
  opts: SourceOptions,
  targetId: string,
  input: MarketplaceFlagInput
): Promise<SourceResult<{ success: boolean; deduplicated?: boolean }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return { source: 'offline', data: { success: false }, fallbackReason: 'API required for flag' };
  }
  const fetcher = opts.fetcher ?? globalThis.fetch;
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
