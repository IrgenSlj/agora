import { dirname, join } from 'node:path';
import { buildPurl, parsePurl } from '../model/purl.js';
import { AgoraStore, CASCache } from '../store/index.js';
import type { FederatedItem, FederationEnv, ServerPackage, SourceId } from './types.js';

/**
 * S2 canonical-source precedence for normalized Artifact rows.
 * Source items remain attributed individually; this order only decides which
 * display metadata wins when multiple sources report the same purl.
 */
export const SYNC_SOURCE_PRECEDENCE: SourceId[] = [
  'official',
  'glama',
  'pulsemcp',
  'skills-github',
  'smithery',
  'github',
  'huggingface',
  'local'
];

export interface FederationSyncBatch {
  source: SourceId;
  items: FederatedItem[];
  prunedItems?: FederatedItem[];
  syncedAt: string;
}

export interface FederationSyncResult {
  source: SourceId;
  upsertedSourceItems: number;
  prunedSourceItems: number;
  indexedArtifacts: number;
  skippedWithoutPurl: number;
  affectedPurls: string[];
}

function resolveStorePath(env: FederationEnv): string | undefined {
  return env.storePath;
}

function resolveCasDir(env: FederationEnv): string | undefined {
  if (env.casDir) return env.casDir;
  if (env.storePath) return join(dirname(env.storePath), 'cas');
  return undefined;
}

function packagePurl(pkg: ServerPackage, fallbackVersion?: string): string | undefined {
  const type = pkg.registryType.trim().toLowerCase();
  const identifier = pkg.identifier.trim();
  const version = pkg.version || fallbackVersion || undefined;
  if (!type || !identifier) return undefined;

  if (type === 'npm' && identifier.startsWith('@')) {
    const slash = identifier.indexOf('/');
    if (slash <= 1 || slash === identifier.length - 1) return undefined;
    return buildPurl({
      type,
      namespace: identifier.slice(0, slash),
      name: identifier.slice(slash + 1),
      version
    });
  }

  if (type === 'github') {
    const [namespace, name] = identifier.split('/', 2);
    if (!namespace || !name) return undefined;
    return buildPurl({ type, namespace, name, version });
  }

  if (identifier.includes('/')) return undefined;
  return buildPurl({ type, name: identifier, version });
}

function npmPackagePurl(identifier: string, version?: string): string | undefined {
  return packagePurl({ registryType: 'npm', identifier, version }, version);
}

function githubPartsFromRepository(
  repository?: string
): { owner: string; repo: string } | undefined {
  if (!repository) return undefined;
  const trimmed = repository
    .trim()
    .replace(/\/+$/g, '')
    .replace(/\.git$/i, '');
  if (!trimmed) return undefined;

  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (ssh) {
    const repo = ssh[2]?.replace(/\.git$/i, '');
    return ssh[1] && repo ? { owner: ssh[1], repo } : undefined;
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== 'github.com') return undefined;
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    return owner && repo ? { owner, repo: repo.replace(/\.git$/i, '') } : undefined;
  } catch {
    return undefined;
  }
}

function githubRepositoryPurl(repository?: string, version?: string): string | undefined {
  const parts = githubPartsFromRepository(repository);
  if (!parts) return undefined;
  return buildPurl({ type: 'github', namespace: parts.owner, name: parts.repo, version });
}

function repositoryForItem(item: FederatedItem): string | undefined {
  return item.kind === 'package' ? item.repository : undefined;
}

export function purlForFederatedItem(item: FederatedItem): string | undefined {
  for (const pkg of item.serverJson?.packages ?? []) {
    try {
      const purl = packagePurl(pkg, item.serverJson?.version || item.version || undefined);
      if (purl) return purl;
    } catch {}
  }

  if (item.kind === 'package' && item.npmPackage) {
    try {
      const purl = npmPackagePurl(item.npmPackage, item.version || undefined);
      if (purl) return purl;
    } catch {}
  }

  try {
    return githubRepositoryPurl(repositoryForItem(item), item.version || undefined);
  } catch {
    return undefined;
  }
}

function publisherNamespace(item: FederatedItem, purl: string): string {
  try {
    const parsed = parsePurl(purl);
    return parsed.namespace || item.author || item.id;
  } catch {
    return item.author || item.id;
  }
}

function sourceUrlForItem(item: FederatedItem, source: SourceId): string {
  const provenance = item.provenance.find((p) => p.source === source) ?? item.provenance[0];
  if (provenance?.sourceUrl) return provenance.sourceUrl;
  const repository = repositoryForItem(item);
  if (repository) return repository;

  switch (source) {
    case 'official':
      return `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(item.id)}/versions`;
    case 'glama':
      return `https://glama.ai/mcp/servers/${item.id}`;
    case 'pulsemcp':
      return `https://api.pulsemcp.com/v0.1/servers/${encodeURIComponent(item.id)}/versions/latest`;
    case 'skills-github':
      return `https://github.com/${item.id.replace(/^skill:/, '')}`;
    case 'smithery':
      return `https://smithery.ai/servers/${item.id}`;
    case 'github':
      return `https://github.com/${item.id}`;
    case 'huggingface':
      return `https://huggingface.co/${item.id}`;
    case 'local':
      return `https://agora.local/catalog/${encodeURIComponent(item.id)}`;
  }
}

function fetchedAtForItem(item: FederatedItem, source: SourceId, syncedAt: string): string {
  return item.provenance.find((p) => p.source === source)?.fetchedAt || syncedAt;
}

function artifactKindForItem(item: FederatedItem): 'mcp-server' | 'agent-skill' {
  return item.category === 'skill' ? 'agent-skill' : 'mcp-server';
}

function upsertArtifactForItem(store: AgoraStore, item: FederatedItem, purl: string): void {
  store.upsertArtifact({
    purl,
    kind: artifactKindForItem(item),
    display_name: item.name || item.id,
    publisher: {
      namespace: publisherNamespace(item, purl),
      identity_verified: item.provenance.some((p) => p.verified === true)
    }
  });
}

function sourceRank(source: string): number {
  const idx = (SYNC_SOURCE_PRECEDENCE as string[]).indexOf(source);
  return idx >= 0 ? idx : SYNC_SOURCE_PRECEDENCE.length;
}

function readSourceItem(cas: CASCache, sha256: string): FederatedItem | undefined {
  const blob = cas.get(sha256);
  if (!blob) return undefined;
  try {
    return JSON.parse(blob.toString('utf8')) as FederatedItem;
  } catch {
    return undefined;
  }
}

function recomputeCanonicalArtifact(store: AgoraStore, cas: CASCache, purl: string): boolean {
  const candidates: Array<{
    row: ReturnType<AgoraStore['listSourceItemsByPurl']>[number];
    item: FederatedItem;
  }> = [];
  for (const row of store.listSourceItemsByPurl(purl)) {
    const item = readSourceItem(cas, row.item_sha256);
    if (item) candidates.push({ row, item });
  }
  candidates.sort((a, b) => {
    const byRank = sourceRank(a.row.source) - sourceRank(b.row.source);
    if (byRank !== 0) return byRank;
    const bySource = a.row.source.localeCompare(b.row.source);
    return bySource !== 0 ? bySource : a.row.upstream_id.localeCompare(b.row.upstream_id);
  });

  const best = candidates[0];
  if (!best) return false;
  upsertArtifactForItem(store, best.item, purl);
  return true;
}

export function syncFederationItems(
  env: FederationEnv,
  batch: FederationSyncBatch
): FederationSyncResult {
  const storePath = resolveStorePath(env);
  const result: FederationSyncResult = {
    source: batch.source,
    upsertedSourceItems: 0,
    prunedSourceItems: 0,
    indexedArtifacts: 0,
    skippedWithoutPurl: 0,
    affectedPurls: []
  };
  if (!storePath) return result;

  const store = new AgoraStore(storePath);
  const cas = new CASCache(resolveCasDir(env));
  const affected = new Set<string>();

  try {
    for (const item of batch.prunedItems ?? []) {
      store.deleteSourceItem(batch.source, item.id);
      result.prunedSourceItems++;
      const purl = purlForFederatedItem(item);
      if (!purl) continue;
      affected.add(purl);
      store.deleteArtifactSource(purl, batch.source);
    }

    for (const item of batch.items) {
      const purl = purlForFederatedItem(item);
      const fetchedAt = fetchedAtForItem(item, batch.source, batch.syncedAt);
      const itemSha256 = cas.put(JSON.stringify(item));

      if (purl) {
        upsertArtifactForItem(store, item, purl);
        store.upsertArtifactSource({
          purl,
          adapter: batch.source,
          upstream_id: item.id,
          url: sourceUrlForItem(item, batch.source),
          first_seen: fetchedAt
        });
        affected.add(purl);
      } else {
        result.skippedWithoutPurl++;
      }

      store.upsertSourceItem({
        source: batch.source,
        upstream_id: item.id,
        purl,
        item_sha256: itemSha256,
        fetched_at: fetchedAt
      });
      result.upsertedSourceItems++;
    }

    for (const purl of affected) {
      if (recomputeCanonicalArtifact(store, cas, purl)) result.indexedArtifacts++;
    }
    result.affectedPurls = Array.from(affected).sort();
  } finally {
    store.close();
  }

  return result;
}
