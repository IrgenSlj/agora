import { getMarketplaceItems, getTrendingTags, similarItems, type MarketplaceItem } from '../../marketplace.js';
import { formatNumber } from '../../format.js';
import { appendHistory } from '../../history.js';
import {
  searchMarketplaceSource,
  findMarketplaceSource,
  trendingMarketplaceSource
} from '../../live.js';
import {
  stringFlag,
  numberFlag,
  sourceOptions,
  sourceLabel,
  warnFallback,
  sourcePayload,
  writeLine,
  writeJson,
  usageError,
  detectDataDir
} from '../helpers.js';
import { header, formatItemList, formatItemTable, formatItemDetail } from '../format.js';
import type { CommandHandler } from './types.js';

export const commandSearch: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const category = stringFlag(parsed, 'category', 'c') || 'all';
  const sortBy = stringFlag(parsed, 'sort', 's') || 'relevance';
  const sortOrder = (stringFlag(parsed, 'order', 'o') || 'desc') as 'asc' | 'desc';
  const table = Boolean(parsed.flags.table);
  const page = numberFlag(parsed, 'page', 'p') || 1;
  const perPage = numberFlag(parsed, 'perPage', 'pp') || 0;
  const limit = perPage > 0 ? perPage : numberFlag(parsed, 'limit', 'n') || 10;

  const result = await searchMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
    query,
    category,
    limit,
    sortBy: sortBy as 'relevance' | 'stars' | 'installs' | 'name' | 'updated',
    sortOrder,
    page,
    perPage
  });
  const results = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, {
        query,
        category,
        sortBy,
        sortOrder,
        page,
        count: results.length,
        items: results
      })
    );
    return 0;
  }

  if (results.length === 0) {
    writeLine(io.stdout, `No results found for "${query}".`);
    return 0;
  }

  writeLine(
    io.stdout,
    header(
      'agora search',
      [`"${query || 'all'}"`, `${results.length} results`, sourceLabel(result)],
      style
    )
  );
  writeLine(io.stdout, '');

  if (table) {
    writeLine(io.stdout, formatItemTable(results, style));
  } else {
    writeLine(io.stdout, formatItemList(results, style));
  }

  if (perPage > 0) {
    writeLine(io.stdout, '');
    writeLine(
      io.stdout,
      style.dim(`Page ${page} · ${perPage} per page. Use --page N to navigate.`)
    );
  }

  appendHistory(detectDataDir(parsed, io), {
    type: 'search',
    query,
    timestamp: new Date().toISOString(),
    results: results.length
  });
  return 0;
};

export const commandBrowse: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'browse requires an item id');

  const result = await findMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
    id,
    type: stringFlag(parsed, 'type', 't')
  });
  const item = result.data;
  warnFallback(result, io);
  if (!item) return usageError(io, `Item not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { item }));
    return 0;
  }

  writeLine(io.stdout, formatItemDetail(item, style));

  const related = similarItems(id, {
    limit: 3,
    type: item.kind === 'workflow' ? 'workflow' : undefined
  });
  if (related.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Related:'));
    for (const rel of related) {
      const tagOverlap = (item.tags ?? []).filter((t) => (rel.tags ?? []).includes(t));
      const reason = tagOverlap.length > 0 ? ` (shares tags: ${tagOverlap.join(', ')})` : '';
      writeLine(
        io.stdout,
        `  ${style.accent(rel.id.padEnd(28))} ${style.dim(formatNumber(rel.installs ?? 0) + ' installs')}${style.dim(reason)}`
      );
    }
  }

  return 0;
};

export const commandTrending: CommandHandler = async (parsed, io, style) => {
  const category = stringFlag(parsed, 'category', 'c') || parsed.args[0] || 'all';
  const limit = numberFlag(parsed, 'limit', 'n') || 5;
  const table = Boolean(parsed.flags.table);
  const result = await trendingMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
    category,
    limit
  });
  const items = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(
      io.stdout,
      sourcePayload(result, { category, count: items.length, tags: getTrendingTags(), items })
    );
    return 0;
  }

  writeLine(io.stdout, header('agora trending', [category, sourceLabel(result)], style));
  writeLine(io.stdout, '');

  if (table) {
    writeLine(io.stdout, formatItemTable(items, style));
  } else {
    writeLine(io.stdout, formatItemList(items, style));
  }

  writeLine(io.stdout, '');
  writeLine(io.stdout, `${style.dim('tags')}  ${getTrendingTags().join(', ')}`);
  return 0;
};

export const commandWorkflows: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const limit = numberFlag(parsed, 'limit', 'n') || 10;
  const result = await searchMarketplaceSource({
    ...(await sourceOptions(parsed, io)),
    query,
    category: 'workflow',
    limit
  });
  const workflows = result.data;
  warnFallback(result, io);

  if (parsed.flags.json) {
    writeJson(io.stdout, sourcePayload(result, { query, count: workflows.length, workflows }));
    return 0;
  }

  writeLine(
    io.stdout,
    header('agora workflows', [`${workflows.length} results`, sourceLabel(result)], style)
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatItemList(workflows, style));
  return 0;
};

export const commandSimilar: CommandHandler = async (parsed, io, style) => {
  const id = parsed.args[0];
  if (!id) return usageError(io, 'similar requires an item id');

  const type = stringFlag(parsed, 'type', 't') as 'package' | 'workflow' | undefined;
  const limit = numberFlag(parsed, 'limit', 'n') || 5;

  const results = similarItems(id, { limit, type });

  if (parsed.flags.json) {
    writeJson(io.stdout, { id, type: type || 'all', count: results.length, items: results });
    return 0;
  }

  if (results.length === 0) {
    writeLine(io.stdout, `No similar items found for "${id}".`);
    return 0;
  }

  writeLine(io.stdout, header('agora similar', [`to ${id}`, `${results.length} results`], style));
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatItemList(results, style));
  return 0;
};

export const commandAuthor: CommandHandler = async (parsed, io, style) => {
  const name = parsed.args[0];
  if (!name) return usageError(io, 'author requires a name');

  const limit = numberFlag(parsed, 'limit', 'n') || 25;
  const page = numberFlag(parsed, 'page', 'p') || 1;
  const nameLower = name.toLowerCase();

  const all = getMarketplaceItems();
  let matches = all.filter((i) => i.author.toLowerCase() === nameLower);
  if (matches.length === 0) {
    matches = all.filter((i) => i.author.toLowerCase().includes(nameLower));
  }

  matches.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));

  const start = (page - 1) * limit;
  const paged = matches.slice(start, start + limit);

  if (parsed.flags.json) {
    writeJson(io.stdout, { author: name, count: matches.length, items: paged });
    return 0;
  }

  if (matches.length === 0) {
    writeLine(io.stdout, `No items by ${name}.`);
    return 0;
  }

  writeLine(io.stdout, header('agora author', [name, `${matches.length} items`], style));
  writeLine(io.stdout, '');

  const kindW = Math.max(4, ...paged.map((i) => i.kind.length));
  const idW = Math.max(2, ...paged.map((i) => i.id.length));
  const installW = 8;
  const starW = 6;

  writeLine(
    io.stdout,
    style.dim(
      'kind'.padEnd(kindW) +
        '  ' +
        'id'.padEnd(idW) +
        '  ' +
        'installs'.padStart(installW) +
        '  ' +
        'stars'.padStart(starW) +
        '  tags'
    )
  );

  for (const item of paged) {
    const tags = (item.tags ?? []).slice(0, 3).join(', ');
    writeLine(
      io.stdout,
      item.kind.padEnd(kindW) +
        '  ' +
        style.accent(item.id.padEnd(idW)) +
        '  ' +
        style.dim(formatNumber(item.installs ?? 0).padStart(installW)) +
        '  ' +
        style.dim(formatNumber(item.stars ?? 0).padStart(starW)) +
        '  ' +
        style.dim(tags)
    );
  }

  if (matches.length > start + limit) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim(`Page ${page}. Use --page ${page + 1} to see more.`));
  }

  return 0;
};

export const commandCompare: CommandHandler = async (parsed, io, style) => {
  const ids = parsed.args;
  if (ids.length < 2) return usageError(io, 'compare requires at least two item ids');

  const typeMap = (type?: string): 'package' | 'workflow' | undefined =>
    type === 'package' || type === 'workflow' ? type : undefined;
  const type = typeMap(stringFlag(parsed, 'type', 't'));

  const items: MarketplaceItem[] = [];
  for (const id of ids) {
    const item = await findMarketplaceSource({ ...(await sourceOptions(parsed, io)), id, type });
    if (!item.data) {
      writeLine(io.stderr, `Item not found: ${id}`);
      return 1;
    }
    items.push(item.data);
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, { ids, count: items.length, items });
    return 0;
  }

  const sharedTags =
    items.length > 1
      ? items
          .map((i) => new Set(i.tags ?? []))
          .reduce((a, b) => new Set([...a].filter((t) => b.has(t))))
      : new Set<string>();

  const attrs: { label: string; get: (item: MarketplaceItem) => string }[] = [
    { label: 'name', get: (i) => i.name },
    { label: 'author', get: (i) => i.author },
    { label: 'installs', get: (i) => formatNumber(i.installs ?? 0) },
    { label: 'stars', get: (i) => formatNumber(i.stars ?? 0) },
    { label: 'category', get: (i) => i.category },
    { label: 'tags', get: (i) => (i.tags ?? []).join(', ') }
  ];

  if (items.some((i) => i.kind === 'package' && (i as any).npmPackage)) {
    attrs.push({
      label: 'npmPackage',
      get: (i) => (i.kind === 'package' && (i as any).npmPackage) || '-'
    });
  }
  if (items.some((i) => (i as any).createdAt)) {
    attrs.push({
      label: 'created',
      get: (i) => ((i as any).createdAt || '').slice(0, 10)
    });
  }

  const colW = Math.max(12, ...items.map((i) => Math.max(i.id.length, i.name.length, 10)));
  const labelW = Math.max(...attrs.map((a) => a.label.length));
  const totalW = labelW + 3 + items.length * (colW + 3) + 1;

  const top =
    style.accent('┌') +
    '─'.repeat(labelW + 2) +
    style.accent('┬') +
    '─'.repeat(totalW - labelW - 6) +
    style.accent('┐');
  const bot =
    style.accent('└') +
    '─'.repeat(labelW + 2) +
    style.accent('┴') +
    '─'.repeat(totalW - labelW - 6) +
    style.accent('┘');

  const hdrCells = items.map((i, idx) => {
    const name = idx === 0 ? style.bold(style.accent(i.id)) : style.accent(i.id);
    return name.padEnd(colW);
  });
  const hdr =
    style.accent('│') +
    ' '.repeat(labelW + 2) +
    style.accent('│') +
    ' ' +
    hdrCells.join(style.accent(' │ ') + ' ') +
    style.accent(' │');

  const rows = attrs.map((attr) => {
    const cells = items.map((item) => {
      const val = attr.get(item);
      if (attr.label === 'tags') {
        return val
          .split(', ')
          .map((t) => (sharedTags.has(t) ? style.accent(t) : style.dim(t)))
          .join(', ')
          .padEnd(colW);
      }
      return (attr.label === 'name' || attr.label === 'npmPackage' ? val : style.dim(val)).padEnd(
        colW
      );
    });
    return (
      style.accent('│') +
      ' ' +
      style.dim(attr.label.padEnd(labelW)) +
      ' ' +
      style.accent('│') +
      ' ' +
      cells.join(style.accent(' │ ') + ' ') +
      style.accent(' │')
    );
  });

  const sepLine =
    style.accent('├') +
    '─'.repeat(labelW + 2) +
    style.accent('┼') +
    '─'.repeat(totalW - labelW - 6) +
    style.accent('┤');

  writeLine(
    io.stdout,
    header(
      'agora compare',
      items.map((i) => i.id),
      style
    )
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, [top, hdr, sepLine, ...rows, bot].join('\n'));
  if (sharedTags.size > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('Shared tags highlighted in accent.'));
  }
  return 0;
};
