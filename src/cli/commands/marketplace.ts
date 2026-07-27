import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findMarketplaceItem, similarItems, sortMarketplaceItems } from '../../catalog/bundled.js';
import { federatedSearch } from '../../federation/index.js';
import type {
  FederatedItem,
  FederationEnv,
  SourceId,
  SourceStatus
} from '../../federation/types.js';
import { formatNumber } from '../../format.js';
import { appendHistory } from '../../history.js';
import { isValidPurl } from '../../model/purl.js';
import { AgoraStore, CASCache } from '../../store/index.js';
import { ExitCode } from '../exit-codes.js';
import { formatItemDetail, formatItemList, formatItemTable, header } from '../format.js';
import {
  detectDataDir,
  numberFlag,
  stringFlag,
  usageError,
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

  // Federated path (the only path): upstream registries + local sync/cache + the
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

  const item = findMarketplaceItem(id, { type: stringFlag(parsed, 'type', 't') });
  if (!item) return usageError(io, `Item not found: ${id}`);

  if (parsed.flags.json) {
    writeJson(io.stdout, { item });
    return 0;
  }

  const theme = cliTheme(style, io);
  writeLine(io.stdout, formatItemDetail(item, theme));

  const related = similarItems(id, { limit: 3 });
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
