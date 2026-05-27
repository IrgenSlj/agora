import type {
  SourceResult,
  SourceOptions,
  DiscussionSourceOptions,
  DiscussionInput,
  Discussion
} from './types.js';
import {
  requestJson,
  normalizeDiscussionCategory,
  mapDiscussion,
  api,
  offline
} from './internal.js';
import { getDiscussions } from '../marketplace.js';

function shouldUseApi(options: SourceOptions): boolean {
  return Boolean(options.useApi && options.apiUrl);
}

async function discussionsApi(options: DiscussionSourceOptions): Promise<Discussion[]> {
  const category = options.category && options.category !== 'all' ? options.category : '';
  const params = category ? `?${new URLSearchParams({ category })}` : '';
  const payload = await requestJson<{ discussions?: Record<string, unknown>[] }>(
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

  const payload = await requestJson<{ discussion?: Record<string, unknown> } & Record<string, unknown>>(
    options,
    '/api/discussions',
    {
      method: 'POST',
      body: JSON.stringify(input)
    }
  );
  const discussion = (payload.discussion || payload) as Record<string, unknown>;

  if (!discussion.id) {
    throw new Error('API response did not include a discussion');
  }

  return api(mapDiscussion(discussion), options);
}
