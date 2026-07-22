import { Hono } from 'hono';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<{ results?: T[] }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
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

export default app;
