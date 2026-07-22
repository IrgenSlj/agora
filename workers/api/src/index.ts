import { Hono } from 'hono';
import { PackageURL } from 'packageurl-js';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results?: T[] }>;
  run?(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export type WorkerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ScheduledControllerLike {
  scheduledTime?: number;
  cron?: string;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Env {
  DB: D1DatabaseLike;
}

interface ArtifactRow {
  purl: string;
  kind: string;
  display_name: string;
  publisher_namespace: string;
  publisher_identity_verified: number;
  updated_at?: string;
}

interface ArtifactSourceRow {
  purl: string;
  adapter: string;
  upstream_id: string;
  url: string;
  first_seen: string;
}

interface ServerPackage {
  registryType: string;
  identifier: string;
  version?: string;
}

interface RawOfficialEntry {
  server?: {
    name?: string;
    version?: string;
    description?: string;
    packages?: ServerPackage[];
  };
  _meta?: {
    'io.modelcontextprotocol.registry/official'?: {
      status?: 'active' | 'deprecated' | 'deleted' | string;
    };
  };
}

interface RawOfficialResponse {
  servers?: RawOfficialEntry[];
}

export interface CatalogSyncResult {
  source: 'official';
  upserted: number;
  skipped: number;
}

const OFFICIAL_REGISTRY_URL =
  'https://registry.modelcontextprotocol.io/v0.1/servers?limit=100&version=latest';

function clampLimit(value: string | null): number {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function sourceRowsByPurl(rows: ArtifactSourceRow[]): Map<string, ArtifactSourceRow[]> {
  const byPurl = new Map<string, ArtifactSourceRow[]>();
  for (const row of rows) {
    const existing = byPurl.get(row.purl) ?? [];
    existing.push(row);
    byPurl.set(row.purl, existing);
  }
  return byPurl;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function buildPurl(components: {
  type: string;
  namespace?: string;
  name: string;
  version?: string;
}): string {
  return new PackageURL(
    components.type,
    components.namespace || null,
    components.name,
    components.version || null,
    null,
    null
  ).toString();
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

function purlForOfficialEntry(entry: RawOfficialEntry): string | undefined {
  const server = entry.server;
  if (!server) return undefined;
  for (const pkg of server.packages ?? []) {
    const purl = packagePurl(pkg, server.version);
    if (purl) return purl;
  }
  return undefined;
}

function publisherNamespace(purl: string, fallback: string): string {
  const parsed = PackageURL.fromString(purl);
  return parsed.namespace || fallback;
}

async function runStatement(statement: D1PreparedStatementLike): Promise<void> {
  if (!statement.run) throw new Error('D1 statement does not support run()');
  await statement.run();
}

export async function syncOfficialRegistry(
  env: Env,
  fetcher: WorkerFetch = fetch
): Promise<CatalogSyncResult> {
  const res = await fetcher(OFFICIAL_REGISTRY_URL);
  if (!res.ok) throw new Error(`official registry returned HTTP ${res.status}`);
  const body = (await res.json()) as RawOfficialResponse;
  let upserted = 0;
  let skipped = 0;

  for (const entry of body.servers ?? []) {
    const status = entry._meta?.['io.modelcontextprotocol.registry/official']?.status;
    const server = entry.server;
    const purl = purlForOfficialEntry(entry);
    if (!server?.name || !purl || status === 'deleted') {
      skipped++;
      continue;
    }

    const namespace = publisherNamespace(purl, server.name);
    await runStatement(
      env.DB.prepare(`
        INSERT INTO artifacts (purl, kind, display_name, publisher_namespace, publisher_identity_verified)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(purl) DO UPDATE SET
          kind = excluded.kind,
          display_name = excluded.display_name,
          publisher_namespace = excluded.publisher_namespace,
          publisher_identity_verified = excluded.publisher_identity_verified,
          updated_at = datetime('now')
      `).bind(purl, 'mcp-server', server.name, namespace, 1)
    );

    await runStatement(
      env.DB.prepare(`
        INSERT INTO artifact_sources (purl, adapter, upstream_id, url, first_seen)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(purl, adapter) DO UPDATE SET
          upstream_id = excluded.upstream_id,
          url = excluded.url
      `).bind(
        purl,
        'official',
        server.name,
        `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(server.name)}/versions`,
        new Date().toISOString()
      )
    );

    upserted++;
  }

  return { source: 'official', upserted, skipped };
}

export const app = new Hono<{ Bindings: Env }>();

app.get('/v1/health', (c) =>
  c.json({
    ok: true,
    service: 'agora-api',
    time: new Date().toISOString()
  })
);

app.get('/v1/catalog', async (c) => {
  if (!c.env.DB) {
    return c.json({ error: 'D1 binding DB is not configured' }, 503);
  }

  const limit = clampLimit(c.req.query('limit') ?? null);
  const cursor = c.req.query('cursor') ?? '';
  const artifactsResult = await c.env.DB.prepare(`
      SELECT purl, kind, display_name, publisher_namespace, publisher_identity_verified, updated_at
      FROM artifacts
      WHERE (? = '' OR purl > ?)
      ORDER BY purl
      LIMIT ?
    `)
    .bind(cursor, cursor, limit)
    .all<ArtifactRow>();

  const artifacts = artifactsResult.results ?? [];
  const purls = artifacts.map((row) => row.purl);
  let sources: ArtifactSourceRow[] = [];
  if (purls.length > 0) {
    const sourceResult = await c.env.DB.prepare(`
        SELECT purl, adapter, upstream_id, url, first_seen
        FROM artifact_sources
        WHERE purl IN (${placeholders(purls.length)})
        ORDER BY purl, adapter
      `)
      .bind(...purls)
      .all<ArtifactSourceRow>();
    sources = sourceResult.results ?? [];
  }

  const sourcesByPurl = sourceRowsByPurl(sources);
  const items = artifacts.map((row) => ({
    purl: row.purl,
    kind: row.kind,
    display_name: row.display_name,
    publisher: {
      namespace: row.publisher_namespace,
      identity_verified: row.publisher_identity_verified === 1
    },
    sources: sourcesByPurl.get(row.purl) ?? [],
    updated_at: row.updated_at
  }));

  return c.json({
    items,
    count: items.length,
    nextCursor: items.length === limit ? items[items.length - 1]?.purl : undefined
  });
});

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledControllerLike, env: Env, ctx: ExecutionContextLike): void {
    ctx.waitUntil(syncOfficialRegistry(env));
  }
};
