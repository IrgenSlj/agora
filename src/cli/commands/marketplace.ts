import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { federatedSearch } from '../../federation/index.js';
import type {
  FederatedItem,
  FederationEnv,
  SourceId,
  SourceStatus
} from '../../federation/types.js';
import { formatNumber } from '../../format.js';
import { appendHistory } from '../../history.js';
import {
  findMarketplaceSource,
  searchMarketplaceSource,
  trendingMarketplaceSource
} from '../../live.js';
import {
  getMarketplaceItems,
  getTrendingTags,
  type MarketplaceItem,
  similarItems,
  sortMarketplaceItems
} from '../../marketplace.js';
import { isValidPurl } from '../../model/purl.js';
import { AgoraStore, CASCache } from '../../store/index.js';
import { ExitCode } from '../exit-codes.js';
import { formatItemDetail, formatItemList, formatItemTable, header } from '../format.js';
import {
  detectDataDir,
  numberFlag,
  sourceLabel,
  sourceOptions,
  sourcePayload,
  stringFlag,
  usageError,
  warnFallback,
  writeJson,
  writeLine
} from '../helpers.js';
import { cliTheme } from '../theme.js';
import type { CommandHandler } from './types.js';

// This allow-list has to grow with SOURCES or `--source smithery` etc. would
// 404 at the CLI layer despite the source being wired. Non-canonical sources
// can still report `offline` until their opt-in env flags are set.
const SEARCHABLE_SOURCE_IDS: SourceId[] = [
  'official',
  'glama',
  'pulsemcp',
  'skills-github',
  'smithery',
  'github',
  'huggingface',
  'local'
];

function isSourceId(value: string): value is SourceId {
  return (SEARCHABLE_SOURCE_IDS as string[]).includes(value);
}

function matchesFederatedCategory(item: FederatedItem, category: string): boolean {
  if (category === 'all') return true;
  if (item.category === category) return true;
  return category === 'package' && item.kind === 'package';
}

function categoryFromKind(kind: string | undefined): string | undefined {
  if (!kind) return undefined;
  if (kind === 'mcp-server') return 'mcp';
  if (kind === 'agent-skill') return 'skill';
  return undefined;
}

function federationEnvFor(
  parsed: Parameters<CommandHandler>[0],
  io: Parameters<CommandHandler>[1]
): FederationEnv {
  const dataDir = detectDataDir(parsed, io);
  const env = parsed.flags.offline ? { ...io.env, AGORA_OFFLINE: '1' } : io.env;
  return {
    fetcher: io.fetcher,
    env,
    home: env?.HOME,
    cacheDir: join(dataDir, 'federation'),
    storePath: join(dataDir, 'agora.db'),
    casDir: join(dataDir, 'cas')
  };
}

type LocalInfoPayload = {
  purl: string;
  artifact: NonNullable<ReturnType<AgoraStore['getArtifact']>>;
  sources: ReturnType<AgoraStore['getArtifactSources']>;
  sourceItems: Array<
    ReturnType<AgoraStore['listSourceItemsByPurl']>[number] & {
      item?: Pick<FederatedItem, 'id' | 'name' | 'description' | 'provenance'>;
    }
  >;
};

function readLocalInfo(purl: string, storePath: string, casDir: string): LocalInfoPayload | null {
  if (!existsSync(storePath)) return null;
  const store = new AgoraStore(storePath);
  const cas = existsSync(casDir) ? new CASCache(casDir) : undefined;

  try {
    const artifact = store.getArtifact(purl);
    if (!artifact) return null;
    const sourceItems = store.listSourceItemsByPurl(purl).map((row) => {
      const blob = cas?.get(row.item_sha256);
      if (!blob) return row;
      try {
        const item = JSON.parse(blob.toString('utf8')) as FederatedItem;
        return {
          ...row,
          item: {
            id: item.id,
            name: item.name,
            description: item.description,
            provenance: item.provenance
          }
        };
      } catch {
        return row;
      }
    });
    return {
      purl,
      artifact,
      sources: store.getArtifactSources(purl),
      sourceItems
    };
  } finally {
    store.close();
  }
}

function statusSummary(statuses: SourceStatus[]): string {
  return statuses
    .map((s) => {
      if (s.state === 'ok') return `${s.source}: ${s.count} results`;
      if (s.state === 'unreachable') return `${s.source}: unreachable`;
      if (s.state === 'offline') return `${s.source}: offline`;
      return `${s.source}: searching`;
    })
    .join(' · ');
}

export const commandSearch: CommandHandler = async (parsed, io, style) => {
  const query = parsed.args.join(' ');
  const kind = stringFlag(parsed, 'kind');
  const kindCategory = categoryFromKind(kind);
  if (kind && !kindCategory) {
    return usageError(io, `Unknown --kind "${kind}". Use mcp-server or agent-skill.`);
  }
  const category = stringFlag(parsed, 'category', 'c') || kindCategory || 'all';
  const sortBy = stringFlag(parsed, 'sort', 's') || 'relevance';
  const sortOrder = (stringFlag(parsed, 'order', 'o') || 'desc') as 'asc' | 'desc';
  const table = Boolean(parsed.flags.table);
  const page = numberFlag(parsed, 'page', 'p') || 1;
  const perPage = numberFlag(parsed, 'perPage', 'pp') || 0;
  const limit = perPage > 0 ? perPage : numberFlag(parsed, 'limit', 'n') || 10;

  const opts = parsed.flags.offline
    ? { useApi: false, fetcher: io.fetcher }
    : await sourceOptions(parsed, io);

  // The legacy hosted-API path (`--api`/`--live`/a configured API URL) is
  // orthogonal to federation — a self-hosted Agora API, not an upstream MCP
  // registry — and stays exactly as it was.
  if (opts.useApi) {
    const result = await searchMarketplaceSource({
      ...opts,
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

    const theme = cliTheme(style, io);
    writeLine(
      io.stdout,
      header(
        'agora search',
        [`"${query || 'all'}"`, `${results.length} results`, sourceLabel(result)],
        theme
      )
    );
    writeLine(io.stdout, '');

    if (table) {
      writeLine(io.stdout, formatItemTable(results, theme));
    } else {
      writeLine(io.stdout, formatItemList(results, theme));
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
  }

  // Federated path (default): upstream registries + local sync/cache + the
  // bundled local catalog, deduped and merged, with honest per-source status.
  const sourceFlag = stringFlag(parsed, 'source');
  if (sourceFlag && sourceFlag !== 'all' && !isSourceId(sourceFlag)) {
    return usageError(
      io,
      `Unknown --source "${sourceFlag}". Use official, glama, pulsemcp, skills-github, smithery, github, huggingface, local, or all.`
    );
  }
  const source = sourceFlag && sourceFlag !== 'all' ? (sourceFlag as SourceId) : undefined;

  const { items, statuses } = await federatedSearch(
    query,
    { source, limit },
    federationEnvFor(parsed, io)
  );

  for (const status of statuses) {
    if (status.state === 'unreachable') {
      writeLine(io.stderr, `Warning: ${status.source} unreachable — ${status.reason}`);
    }
  }

  let results: FederatedItem[] = items.filter((item) => matchesFederatedCategory(item, category));
  // Each source has already ranked its own results by relevance (local via its
  // BM25 index, official via the registry's own `search=` ranking) — there's
  // no cross-source score to re-derive that from, so leave the merge order
  // alone for the default 'relevance' mode rather than falling back to a
  // crude name-substring heuristic that would bury exact matches. Explicit
  // sort modes (stars/installs/name/updated) are plain comparisons and sort
  // correctly without a BM25 score.
  if (sortBy !== 'relevance') {
    results.sort(sortMarketplaceItems(sortBy, sortOrder, query));
  }

  const totalMatches = results.length;
  if (perPage > 0) {
    const start = (page - 1) * perPage;
    results = results.slice(start, start + perPage);
  } else {
    results = results.slice(0, limit);
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, {
      query,
      category,
      sortBy,
      sortOrder,
      page,
      source: sourceFlag || 'all',
      statuses,
      count: results.length,
      items: results
    });
    return 0;
  }

  if (totalMatches === 0) {
    writeLine(io.stdout, `No results found for "${query}".`);
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header(
      'agora search',
      [`"${query || 'all'}"`, `${totalMatches} results`, statusSummary(statuses)],
      theme
    )
  );
  writeLine(io.stdout, '');

  if (table) {
    writeLine(io.stdout, formatItemTable(results, theme));
  } else {
    writeLine(io.stdout, formatItemList(results, theme));
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
    results: totalMatches
  });
  return 0;
};

export const commandInfo: CommandHandler = async (parsed, io, style) => {
  const purl = parsed.args[0];
  if (!purl) return usageError(io, 'info requires a purl');
  if (!isValidPurl(purl)) return usageError(io, `Invalid purl: ${purl}`);

  const dataDir = detectDataDir(parsed, io);
  const storePath = stringFlag(parsed, 'store') || join(dataDir, 'agora.db');
  const casDir = stringFlag(parsed, 'casDir') || join(dataDir, 'cas');
  const payload = readLocalInfo(purl, storePath, casDir);

  if (!payload) {
    writeLine(
      io.stderr,
      `Artifact not found in local sync: ${purl}. Run \`agora refresh\` to populate the local store.`
    );
    return ExitCode.USAGE;
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, payload);
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(io.stdout, header('agora info', [purl, 'local sync'], theme));
  writeLine(io.stdout, '');
  writeLine(io.stdout, `${style.dim('kind')}       ${payload.artifact.kind}`);
  writeLine(io.stdout, `${style.dim('name')}       ${theme.accent(payload.artifact.display_name)}`);
  writeLine(io.stdout, `${style.dim('publisher')}  ${payload.artifact.publisher_namespace}`);
  writeLine(
    io.stdout,
    `${style.dim('verified')}   ${payload.artifact.publisher_identity_verified ? 'yes' : 'no'}`
  );

  if (payload.sources.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('sources'));
    for (const source of payload.sources) {
      writeLine(io.stdout, `  ${source.adapter.padEnd(10)} ${source.upstream_id}`);
      writeLine(io.stdout, `  ${style.dim(source.url)}`);
    }
  }

  if (payload.sourceItems.length > 0) {
    writeLine(io.stdout, '');
    writeLine(io.stdout, style.dim('source items'));
    for (const row of payload.sourceItems) {
      const label = row.item ? `${row.item.name} (${row.item.id})` : row.upstream_id;
      writeLine(io.stdout, `  ${row.source.padEnd(10)} ${label}`);
      writeLine(io.stdout, `  ${style.dim(`fetched ${row.fetched_at} · ${row.item_sha256}`)}`);
    }
  }

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

  const theme = cliTheme(style, io);
  writeLine(io.stdout, formatItemDetail(item, theme));

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

  const theme = cliTheme(style, io);
  writeLine(io.stdout, header('agora trending', [category, sourceLabel(result)], theme));
  writeLine(io.stdout, '');

  if (table) {
    writeLine(io.stdout, formatItemTable(items, theme));
  } else {
    writeLine(io.stdout, formatItemList(items, theme));
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

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header('agora workflows', [`${workflows.length} results`, sourceLabel(result)], theme)
  );
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatItemList(workflows, theme));
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

  const theme = cliTheme(style, io);
  writeLine(io.stdout, header('agora similar', [`to ${id}`, `${results.length} results`], theme));
  writeLine(io.stdout, '');
  writeLine(io.stdout, formatItemList(results, theme));
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

  const theme = cliTheme(style, io);
  writeLine(io.stdout, header('agora author', [name, `${matches.length} items`], theme));
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
      return ExitCode.USAGE;
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

  const theme = cliTheme(style, io);
  writeLine(
    io.stdout,
    header(
      'agora compare',
      items.map((i) => i.id),
      theme
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
