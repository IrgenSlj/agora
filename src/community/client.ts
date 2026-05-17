import type { BoardId, BoardSummary, Thread, Reply, Flag } from './types.js';
import type { SourceOptions, SourceResult } from '../live.js';
import { BOARD_IDS } from './types.js';

export interface CommunityBoardsResult {
  boards: BoardSummary[];
}

export interface CommunityThreadsResult {
  threads: Thread[];
  total: number;
}

export interface CommunityThreadResult {
  thread: Thread;
  replies: Reply[];
}

export interface CreateThreadInput {
  board: BoardId;
  title: string;
  content: string;
}

export interface CreateReplyInput {
  content: string;
  parentId?: string;
}

export interface VoteInput {
  value: -1 | 1;
  targetType: 'discussion' | 'reply';
}

export interface FlagInput {
  reason: Flag['reason'];
  notes?: string;
  targetType: 'discussion' | 'reply';
}

const FIXTURE_BOARDS: BoardSummary[] = BOARD_IDS.map((id) => ({
  id,
  threadCount: id === 'mcp' ? 236 : id === 'agents' ? 112 : id === 'ask' ? 201 : 64,
  newToday: id === 'mcp' ? 14 : id === 'agents' ? 8 : id === 'ask' ? 6 : 2
}));

const FIXTURE_THREADS: Record<string, Thread[]> = {
  mcp: [
    {
      id: 't-mcp-1',
      board: 'mcp',
      title: 'How are you composing servers?',
      author: 'ada',
      content:
        'I am stacking mcp-postgres, mcp-filesystem and a thin orchestrator. Anyone using a different pattern?',
      score: 12,
      replyCount: 7,
      flagCount: 0,
      createdAt: new Date(Date.now() - 6 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 2 * 3600000).toISOString()
    },
    {
      id: 't-mcp-2',
      board: 'mcp',
      title: 'Lifecycle hooks: keep them or drop them?',
      author: 'lin',
      content:
        'The spec is ambiguous about init/shutdown ordering when multiple servers share transports.',
      score: 8,
      replyCount: 4,
      flagCount: 0,
      createdAt: new Date(Date.now() - 14 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 10 * 3600000).toISOString()
    }
  ],
  agents: [
    {
      id: 't-agents-1',
      board: 'agents',
      title: 'Best local model for tool use today?',
      author: 'bob',
      content: 'Testing Qwen2.5 7B vs Llama 3.1 8B for MCP tool calling. Results inside.',
      score: 24,
      replyCount: 12,
      flagCount: 1,
      createdAt: new Date(Date.now() - 4 * 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1 * 3600000).toISOString()
    }
  ]
};

const FIXTURE_REPLIES: Record<string, Reply[]> = {
  't-mcp-1': [
    {
      id: 'r-mcp-1-1',
      threadId: 't-mcp-1',
      author: 'lin',
      content: 'We compose at the orchestrator and keep servers single-purpose.',
      score: 4,
      flagCount: 0,
      createdAt: new Date(Date.now() - 5 * 3600000).toISOString()
    },
    {
      id: 'r-mcp-1-2',
      threadId: 't-mcp-1',
      parentId: 'r-mcp-1-1',
      author: 'ada',
      content: 'Useful, thanks. Do you use a shared schema package?',
      score: 2,
      flagCount: 0,
      createdAt: new Date(Date.now() - 4 * 3600000).toISOString()
    }
  ]
};

export async function communityBoardsSource(
  opts: SourceOptions
): Promise<SourceResult<CommunityBoardsResult>> {
  if (opts.useApi && opts.apiUrl) {
    try {
      const res = await fetcher(opts, `${opts.apiUrl}/api/community/boards`);
      if (res.ok) {
        const data = (await res.json()) as CommunityBoardsResult;
        return { source: 'api', apiUrl: opts.apiUrl, data };
      }
    } catch {
      /* fall through */
    }
  }
  return {
    source: 'offline',
    data: { boards: FIXTURE_BOARDS },
    fallbackReason: 'using fixture data'
  };
}

export async function communityThreadsSource(
  opts: SourceOptions,
  board: BoardId,
  sort: 'top' | 'new' | 'active' = 'active',
  page = 1
): Promise<SourceResult<CommunityThreadsResult>> {
  if (opts.useApi && opts.apiUrl) {
    try {
      const url = `${opts.apiUrl}/api/community/threads?board=${board}&sort=${sort}&page=${page}`;
      const res = await fetcher(opts, url);
      if (res.ok) {
        const data = (await res.json()) as CommunityThreadsResult;
        return { source: 'api', apiUrl: opts.apiUrl, data };
      }
    } catch {
      /* fall through */
    }
  }

  const threads = sortThreads(FIXTURE_THREADS[board] ?? [], sort);
  return {
    source: 'offline',
    data: { threads, total: threads.length },
    fallbackReason: 'using fixture data'
  };
}

export async function communityThreadSource(
  opts: SourceOptions,
  threadId: string
): Promise<SourceResult<CommunityThreadResult>> {
  if (opts.useApi && opts.apiUrl) {
    try {
      const res = await fetcher(opts, `${opts.apiUrl}/api/community/thread/${threadId}`);
      if (res.ok) {
        const data = (await res.json()) as CommunityThreadResult;
        return { source: 'api', apiUrl: opts.apiUrl, data };
      }
    } catch {
      /* fall through */
    }
  }

  const thread = Object.values(FIXTURE_THREADS)
    .flat()
    .find((t) => t.id === threadId);
  const replies = FIXTURE_REPLIES[threadId] ?? [];

  if (!thread) {
    return {
      source: 'offline',
      data: { thread: null as any, replies: [] },
      fallbackReason: 'thread not found'
    };
  }

  return {
    source: 'offline',
    data: { thread, replies: buildReplyTree(replies) }
  };
}

export async function createThreadSource(
  opts: SourceOptions,
  input: CreateThreadInput
): Promise<SourceResult<{ thread: Thread }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return {
      source: 'offline',
      data: { thread: null as any },
      fallbackReason: 'API required for create'
    };
  }
  const res = await fetcher(opts, `${opts.apiUrl}/api/community/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'request failed' }));
    throw new Error(err.error || `Failed to create thread: ${res.status}`);
  }
  const data = (await res.json()) as { thread: Thread };
  return { source: 'api', apiUrl: opts.apiUrl, data };
}

export async function createReplySource(
  opts: SourceOptions,
  parentId: string,
  input: CreateReplyInput
): Promise<SourceResult<{ reply: Reply }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return {
      source: 'offline',
      data: { reply: null as any },
      fallbackReason: 'API required for reply'
    };
  }
  const res = await fetcher(opts, `${opts.apiUrl}/api/community/reply/${parentId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'request failed' }));
    throw new Error(err.error || `Failed to create reply: ${res.status}`);
  }
  const data = (await res.json()) as { reply: Reply };
  return { source: 'api', apiUrl: opts.apiUrl, data };
}

export async function voteSource(
  opts: SourceOptions,
  targetId: string,
  input: VoteInput
): Promise<SourceResult<{ success: boolean }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return { source: 'offline', data: { success: false }, fallbackReason: 'API required for vote' };
  }
  const res = await fetcher(opts, `${opts.apiUrl}/api/community/vote/${targetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`Failed to vote: ${res.status}`);
  return { source: 'api', apiUrl: opts.apiUrl, data: { success: true } };
}

export async function flagSource(
  opts: SourceOptions,
  targetId: string,
  input: FlagInput
): Promise<SourceResult<{ success: boolean }>> {
  if (!opts.useApi || !opts.apiUrl || !opts.token) {
    return { source: 'offline', data: { success: false }, fallbackReason: 'API required for flag' };
  }
  const res = await fetcher(opts, `${opts.apiUrl}/api/community/flag/${targetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
    body: JSON.stringify(input)
  });
  if (!res.ok) throw new Error(`Failed to flag: ${res.status}`);
  return { source: 'api', apiUrl: opts.apiUrl, data: { success: true } };
}

function sortThreads(threads: Thread[], sort: string): Thread[] {
  const sorted = [...threads];
  if (sort === 'new') {
    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (sort === 'top') {
    sorted.sort((a, b) => b.score - a.score);
  } else {
    sorted.sort((a, b) => {
      const scoreA =
        a.score / Math.pow((Date.now() - new Date(a.createdAt).getTime()) / 3600000 + 2, 1.8);
      const scoreB =
        b.score / Math.pow((Date.now() - new Date(b.createdAt).getTime()) / 3600000 + 2, 1.8);
      return scoreB - scoreA;
    });
  }
  return sorted;
}

function buildReplyTree(replies: Reply[]): Reply[] {
  const map = new Map<string, Reply>();
  const roots: Reply[] = [];

  for (const r of replies) {
    map.set(r.id, { ...r, children: [] });
  }

  for (const r of replies) {
    const node = map.get(r.id)!;
    if (r.parentId && map.has(r.parentId)) {
      map.get(r.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function fetcher(opts: SourceOptions, url: string, init?: RequestInit): Promise<Response> {
  const f = (opts as any).fetcher ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
  try {
    const res = await f(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}
