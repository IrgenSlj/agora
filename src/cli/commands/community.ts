import type { BoardId, Flag } from '../../community/types.js';
import { BOARD_IDS } from '../../community/types.js';
import {
  communityBoardsSource,
  communityThreadsSource,
  communityThreadSource,
  createThreadSource,
  createReplySource,
  voteSource,
  flagSource,
  adminHideSource,
  adminLogSource,
  adminRecomputeSource
} from '../../community/client.js';
import { createDiscussionSource, discussionsSource, flagMarketplaceSource } from '../../live.js';
import { normalizeNewsSource, DEFAULT_NEWS_CONFIG, hostFromUrl } from '../../news/types.js';
import { rankItems } from '../../news/score.js';
import { readCache, writeCache, isStale } from '../../news/cache.js';
import { hnSource } from '../../news/sources/hn.js';
import { redditSource } from '../../news/sources/reddit.js';
import { githubTrendingSource } from '../../news/sources/github-trending.js';
import { arxivSource } from '../../news/sources/arxiv.js';
import { formatNumber } from '../../format.js';
import {
  stringFlag,
  requiredStringFlag,
  numberFlag,
  sourceOptions,
  writeSourceOptions,
  sourceLabel,
  warnFallback,
  sourcePayload,
  writeLine,
  writeJson,
  usageError,
  detectDataDir,
  contentInput,
  discussionCategoryFlag
} from '../helpers.js';
import { header, truncate } from '../format.js';
import type { CommandHandler } from './types.js';

export const commandNews: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const sourceOpt = stringFlag(parsed, 'source', 's');
  const source = sourceOpt ? normalizeNewsSource(sourceOpt) : undefined;
  const limit = numberFlag(parsed, 'limit', 'n') || 20;
  const refresh = Boolean(parsed.flags.refresh);

  const dataDir = detectDataDir(parsed, io);
  let cached = readCache(dataDir);
  const now = new Date();
  const config = DEFAULT_NEWS_CONFIG;

  const adapters: [string, { fetch(opts: { signal?: AbortSignal }): Promise<any> }][] = [
    ['hn', hnSource],
    ['reddit', redditSource],
    ['github-trending', githubTrendingSource],
    ['arxiv', arxivSource]
  ];

  const fetchWithTimeout = (
    fn: (signal: AbortSignal) => Promise<any>,
    ms = 10000
  ): Promise<any> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('timeout'));
      }, ms);
      fn(controller.signal).then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  };

  const refreshSource = async (
    src: string,
    adapter: { fetch(opts: { signal?: AbortSignal }): Promise<any> }
  ): Promise<void> => {
    try {
      const fresh = await fetchWithTimeout((signal) => adapter.fetch({ signal }));
      cached = cached.filter((i: any) => i.source !== src);
      cached.push(...fresh);
    } catch {
      // keep stale
    }
  };

  if (refresh) {
    for (const [src, adapter] of adapters) {
      await refreshSource(src, adapter);
    }
  } else {
    for (const [src, adapter] of adapters) {
      const cfg = config.sources[src as keyof typeof config.sources];
      if (cfg?.enabled && isStale(cached, src as any, cfg.ttlMinutes, now)) {
        await refreshSource(src, adapter);
      }
    }
  }

  const ranked = rankItems(cached, config, now);
  writeCache(dataDir, cached);

  let items = ranked;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(
      (i) => i.title.toLowerCase().includes(q) || i.tags.some((t) => t.includes(q))
    );
  }
  if (source) {
    items = items.filter((i) => i.source === source);
  }
  items = items.slice(0, limit);

  if (parsed.flags.json) {
    writeJson(io.stdout, { count: items.length, items, source: source || 'all' });
    return 0;
  }

  if (items.length === 0) {
    writeLine(io.stdout, 'No news items found.');
    return 0;
  }

  writeLine(
    io.stdout,
    header(
      'agora news',
      [`${items.length} stories`, source ? `source: ${source}` : 'all sources'],
      style
    )
  );
  writeLine(io.stdout, '');
  for (const item of items) {
    const ageH = Math.round((now.getTime() - new Date(item.publishedAt).getTime()) / 3600000);
    const age = ageH < 1 ? '<1h' : ageH < 24 ? `${ageH}h` : `${Math.round(ageH / 24)}d`;
    const host = hostFromUrl(item.url);
    writeLine(
      io.stdout,
      `${style.accent(item.source.padEnd(6))} ${style.dim(age.padEnd(4))} ${style.accent(formatNumber(item.engagement).padStart(7))}  ${style.dim('s' + item.score.toFixed(2))}   ${item.title}`
    );
    if (host) writeLine(io.stdout, `       ${style.dim(host)}`);
    if (query) writeLine(io.stdout, '');
  }
  return 0;
};

export const commandCommunity: CommandHandler = async (parsed, io, style) => {
  const boardArg = parsed.args[0];
  if (boardArg !== undefined && !BOARD_IDS.includes(boardArg as BoardId)) {
    return usageError(io, `Unknown board "${boardArg}". Valid: ${BOARD_IDS.join(', ')}`);
  }
  const board = boardArg as BoardId | undefined;
  const sortRaw = stringFlag(parsed, 'sort') || 'active';
  if (!['top', 'new', 'active'].includes(sortRaw)) {
    return usageError(io, `Unknown sort "${sortRaw}". Valid: top, new, active`);
  }
  const sort = sortRaw as 'top' | 'new' | 'active';

  const opts = await sourceOptions(parsed, io);

  if (board) {
    const result = await communityThreadsSource(opts, board, sort);
    const threads = result.data.threads;

    if (parsed.flags.json) {
      writeJson(io.stdout, { board, sort, count: threads.length, threads });
      return 0;
    }

    if (threads.length === 0) {
      writeLine(io.stdout, `No threads in /${board}.`);
      return 0;
    }

    writeLine(
      io.stdout,
      header(`agora community /${board}`, [`${threads.length} threads`, `sort: ${sort}`], style)
    );
    writeLine(io.stdout, '');
    for (const t of threads) {
      const ageH = Math.round((Date.now() - new Date(t.createdAt).getTime()) / 3600000);
      writeLine(io.stdout, `  ${style.accent(t.title)}`);
      writeLine(
        io.stdout,
        `     ${style.dim(t.author + ' \u00b7 ' + ageH + 'h \u00b7 ' + t.score + '\u2191 \u00b7 ' + t.replyCount + ' replies')}`
      );
    }
    return 0;
  }

  const boardsResult = await communityBoardsSource(opts);
  const boards = boardsResult.data.boards;

  if (parsed.flags.json) {
    writeJson(io.stdout, { boards });
    return 0;
  }

  writeLine(io.stdout, header('agora community', [`${boards.length} boards`], style));
  writeLine(io.stdout, '');
  for (const b of boards) {
    writeLine(
      io.stdout,
      `  ${style.accent('/' + b.id.padEnd(12))} ${style.dim(b.threadCount + ' threads, ' + b.newToday + ' new today')}`
    );
  }
  writeLine(io.stdout, '');
  writeLine(io.stdout, style.dim('Run `agora community <board>` to see threads.'));
  return 0;
};

export const commandThread: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'thread requires a thread id');

  const opts = await sourceOptions(parsed, io);
  const result = await communityThreadSource(opts, id);
  const { thread, replies } = result.data;

  if (!thread) return usageError(io, `Thread not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, { thread, replies });
    return 0;
  }

  const ageH = Math.round((Date.now() - new Date(thread.createdAt).getTime()) / 3600000);
  writeLine(io.stdout, style.bold(thread.title));
  writeLine(
    io.stdout,
    `${style.dim(thread.author + ' \u00b7 ' + ageH + 'h \u00b7 ' + thread.score + '\u2191 \u00b7 ' + thread.replyCount + ' replies')}`
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, thread.content);
  if (replies.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('--- replies ---'));
    for (const r of replies) {
      const rAgeH = Math.round((Date.now() - new Date(r.createdAt).getTime()) / 3600000);
      writeLine(
        io.stdout,
        `  ${style.dim(r.author + ' \u00b7 ' + rAgeH + 'h')} ${style.accent(r.score + '\u2191')}`
      );
      writeLine(io.stdout, `  ${r.content}`);
    }
  }
  return 0;
};

export const commandPost: CommandHandler = async (parsed, io, style) => {
  const source = await writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const board = (stringFlag(parsed, 'board') || stringFlag(parsed, 'b')) as BoardId | undefined;
  const title = requiredStringFlag(parsed, 'title');
  const content = contentInput(parsed, io);

  if (!board || !title || !content) {
    return usageError(io, 'post requires --board, --title and --content or --content-file');
  }

  const result = await createThreadSource(source.options, { board, title, content });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { thread: result.data.thread }));
    return 0;
  }

  writeLine(io.stdout, `Posted to /${board}: ${style.accent(result.data.thread?.title || title)}`);
  writeLine(io.stdout, `${sourceLabel(result)}`);
  return 0;
};

export const commandReply: CommandHandler = async (parsed, io, style) => {
  const parentId = parsed.args[0];
  if (!parentId) return usageError(io, 'reply requires a thread or reply id');

  const source = await writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const content = contentInput(parsed, io);
  if (!content) return usageError(io, 'reply requires --content or --content-file');

  const result = await createReplySource(source.options, parentId, {
    content,
    parentId: stringFlag(parsed, 'parentId')
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { reply: result.data.reply }));
    return 0;
  }

  writeLine(io.stdout, `Replied to ${style.accent(parentId)}`);
  writeLine(io.stdout, `${sourceLabel(result)}`);
  return 0;
};

export const commandVote: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'vote requires a thread or reply id');

  const source = await writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const up = parsed.flags.up === true;
  const down = parsed.flags.down === true;
  if (!up && !down) return usageError(io, 'vote requires --up or --down');

  const value: -1 | 1 = up ? 1 : -1;
  const targetType = (stringFlag(parsed, 'type') || 'discussion') as 'discussion' | 'reply';

  await voteSource(source.options, id, { value, targetType });

  if (parsed.flags.json) {
    writeJson(io.stdout, { id, value, targetType, success: true });
    return 0;
  }

  writeLine(io.stdout, up ? `Upvoted ${style.accent(id)}` : `Downvoted ${style.accent(id)}`);
  return 0;
};

export const commandFlag: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'flag requires an item id');

  const flagMarketplace = (kind?: string): boolean =>
    !kind || kind === 'package' || kind === 'workflow';

  const reasonOpt = stringFlag(parsed, 'reason');
  const validReasons = ['spam', 'harassment', 'undisclosed-llm', 'malicious', 'other'];
  const reason = (
    reasonOpt && validReasons.includes(reasonOpt) ? reasonOpt : 'other'
  ) as Flag['reason'];

  const type = stringFlag(parsed, 'type') || 'discussion';

  if (flagMarketplace(type)) {
    const source = await writeSourceOptions(parsed, io);
    if (!source.ok) return usageError(io, source.error);

    const targetType = (type === 'workflow' ? 'workflow' : 'package') as 'package' | 'workflow';
    const result = await flagMarketplaceSource(source.options, id, {
      reason,
      targetType,
      notes: stringFlag(parsed, 'notes')
    });

    if (parsed.flags.json) {
      writeJson(io.stdout, {
        id,
        reason,
        targetType,
        success: result.data.success,
        deduplicated: result.data.deduplicated
      });
      return result.data.success ? 0 : 1;
    }

    if (result.data.deduplicated) {
      writeLine(io.stdout, `Already flagged ${style.accent(id)}`);
    } else if (result.data.success) {
      writeLine(io.stdout, `Flagged ${style.accent(id)} for ${reason} (${targetType})`);
    } else {
      writeLine(
        io.stdout,
        `Could not flag — API not configured. Run \`agora auth login --api-url <url>\` first.`
      );
      return 1;
    }
    return 0;
  }

  const source = await writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const targetType = (type === 'discussion' || type === 'reply' ? type : 'discussion') as
    | 'discussion'
    | 'reply';

  await flagSource(source.options, id, { reason, targetType, notes: stringFlag(parsed, 'notes') });

  if (parsed.flags.json) {
    writeJson(io.stdout, { id, reason, targetType, success: true });
    return 0;
  }

  writeLine(io.stdout, `Flagged ${style.accent(id)} for ${reason}`);
  return 0;
};

export const commandDiscussions: CommandHandler = async (parsed, io, style) => {
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const query = parsed.args.join(' ');
  const result = await discussionsSource({ ...(await sourceOptions(parsed, io)), category, query });
  const discussions = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { category, query, count: discussions.length, discussions })
    );
    return 0;
  }

  if (discussions.length === 0) {
    writeLine(io.stdout, 'No discussions found.');
    return 0;
  }

  writeLine(
    io.stdout,
    header('agora discussions', [`${discussions.length} results`, sourceLabel(result)], style)
  );
  writeLine(io.stdout, '');
  writeLine(
    io.stdout,
    discussions
      .map((discussion, index) => {
        return [
          `${index + 1}. ${style.accent(discussion.title)} ${style.dim('[' + discussion.category + ']')}`,
          `   ${truncate(discussion.content, 88)}`,
          `   ${style.dim('replies ' + discussion.replies + ' · stars ' + discussion.stars + ' · by ' + discussion.author)}`
        ].join('\n');
      })
      .join('\n\n')
  );
  return 0;
};

export const commandDiscuss: CommandHandler = async (parsed, io, style) => {
  const source = await writeSourceOptions(parsed, io);
  if (!source.ok) return usageError(io, source.error);

  const title = requiredStringFlag(parsed, 'title');
  const content = contentInput(parsed, io);
  if (!title || !content) {
    return usageError(io, 'discuss requires --title and --content or --content-file');
  }

  const category = discussionCategoryFlag(parsed);
  if (!category.ok) return usageError(io, category.error);

  const result = await createDiscussionSource(source.options, {
    title,
    content,
    category: category.value
  });

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { discussion: result.data }));
    return 0;
  }

  writeLine(io.stdout, `Created discussion ${style.accent(result.data.id)}`);
  writeLine(io.stdout, `${result.data.title} (${sourceLabel(result)})`);
  return 0;
};

export const commandAdmin: CommandHandler = async (parsed, io, style) => {
  const sub = parsed.args[0];

  if (sub === 'hide') {
    const id = parsed.args[1];
    if (!id) return usageError(io, 'admin hide requires an id');

    const reason = stringFlag(parsed, 'reason');
    if (!reason) return usageError(io, 'admin hide requires --reason');

    const targetType = (stringFlag(parsed, 'type') || 'discussion') as 'discussion' | 'reply';
    if (targetType !== 'discussion' && targetType !== 'reply') {
      return usageError(io, '--type must be discussion or reply');
    }

    const source = await writeSourceOptions(parsed, io);
    if (!source.ok) return usageError(io, source.error);

    try {
      const result = await adminHideSource(source.options, id, { targetType, reason });
      if (parsed.flags.json) {
        writeJson(io.stdout, result.data);
        return 0;
      }
      writeLine(io.stdout, `Hid ${style.accent(id)} (${targetType}); audit id ${style.dim(result.data.id)}`);
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Admin access required') {
        writeLine(io.stderr, 'Admin access required');
        return 1;
      }
      throw e;
    }
  }

  if (sub === 'log') {
    const limit = numberFlag(parsed, 'limit') || 50;

    const source = await writeSourceOptions(parsed, io);
    if (!source.ok) return usageError(io, source.error);

    try {
      const result = await adminLogSource(source.options, { limit });
      const entries = result.data.entries;

      if (parsed.flags.json) {
        writeJson(io.stdout, { entries });
        return 0;
      }

      if (entries.length === 0) {
        writeLine(io.stdout, 'No kill-switch log entries.');
        return 0;
      }

      const COL = { at: 20, op: 16, type: 12, target: 24 };
      writeLine(
        io.stdout,
        [
          'acted_at'.padEnd(COL.at),
          'operator'.padEnd(COL.op),
          'type'.padEnd(COL.type),
          'target'.padEnd(COL.target),
          'reason'
        ].join('  ')
      );
      writeLine(io.stdout, '-'.repeat(COL.at + COL.op + COL.type + COL.target + 40));
      for (const e of entries) {
        writeLine(
          io.stdout,
          [
            e.actedAt.slice(0, COL.at).padEnd(COL.at),
            e.operatorUsername.slice(0, COL.op).padEnd(COL.op),
            e.targetType.slice(0, COL.type).padEnd(COL.type),
            e.targetId.slice(0, COL.target).padEnd(COL.target),
            e.reason
          ].join('  ')
        );
      }
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Admin access required') {
        writeLine(io.stderr, 'Admin access required');
        return 1;
      }
      throw e;
    }
  }

  if (sub === 'recompute') {
    const source = await writeSourceOptions(parsed, io);
    if (!source.ok) return usageError(io, source.error);

    try {
      const result = await adminRecomputeSource(source.options);
      if (parsed.flags.json) {
        writeJson(io.stdout, result.data);
        return 0;
      }
      writeLine(io.stdout, `Recomputed ${result.data.recomputed} users in ${result.data.durationMs}ms`);
      return 0;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'Admin access required') {
        writeLine(io.stderr, 'Admin access required');
        return 1;
      }
      throw e;
    }
  }

  writeLine(io.stdout, 'Usage:');
  writeLine(io.stdout, '  agora admin hide <id> --reason <r> [--type discussion|reply]');
  writeLine(io.stdout, '  agora admin log [--limit 50]');
  writeLine(io.stdout, '  agora admin recompute');
  return 1;
};
