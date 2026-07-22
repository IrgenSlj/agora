import { describe, expect, test } from 'vitest';
import { app, type Env } from '../workers/api/src/index';

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

class FakeStatement {
  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
    private readonly values: unknown[] = []
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, values);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM artifact_sources')) {
      const purls = new Set(this.values.map(String));
      return {
        results: this.db.sources
          .filter((row) => purls.has(row.purl))
          .sort((a, b) => a.purl.localeCompare(b.purl) || a.adapter.localeCompare(b.adapter)) as T[]
      };
    }

    const cursor = String(this.values[0] ?? '');
    const limit = Number(this.values[2] ?? 50);
    return {
      results: this.db.artifacts
        .filter((row) => !cursor || row.purl > cursor)
        .sort((a, b) => a.purl.localeCompare(b.purl))
        .slice(0, limit) as T[]
    };
  }
}

class FakeD1 {
  constructor(
    readonly artifacts: ArtifactRow[],
    readonly sources: ArtifactSourceRow[]
  ) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

function env(): Env {
  return {
    DB: new FakeD1(
      [
        {
          purl: 'pkg:npm/@example/a@1.0.0',
          kind: 'mcp-server',
          display_name: 'A',
          publisher_namespace: '@example',
          publisher_identity_verified: 1,
          updated_at: '2026-07-22T00:00:00.000Z'
        },
        {
          purl: 'pkg:npm/@example/b@1.0.0',
          kind: 'mcp-server',
          display_name: 'B',
          publisher_namespace: '@example',
          publisher_identity_verified: 0,
          updated_at: '2026-07-22T00:00:00.000Z'
        }
      ],
      [
        {
          purl: 'pkg:npm/@example/a@1.0.0',
          adapter: 'official',
          upstream_id: 'example/a',
          url: 'https://registry.modelcontextprotocol.io/v0.1/servers/example%2Fa/versions',
          first_seen: '2026-07-22T00:00:00.000Z'
        }
      ]
    )
  };
}

describe('workers/api', () => {
  test('GET /v1/health returns an ok health payload', async () => {
    const res = await app.request('/v1/health', {}, env());
    const body = (await res.json()) as { ok: boolean; service: string };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, service: 'agora-api' });
  });

  test('GET /v1/catalog pages artifacts with sources', async () => {
    const res = await app.request('/v1/catalog?limit=1', {}, env());
    const body = (await res.json()) as {
      count: number;
      nextCursor?: string;
      items: Array<{ purl: string; publisher: unknown; sources: unknown[] }>;
    };

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.nextCursor).toBe('pkg:npm/@example/a@1.0.0');
    expect(body.items[0]).toMatchObject({
      purl: 'pkg:npm/@example/a@1.0.0',
      publisher: { namespace: '@example', identity_verified: true },
      sources: [expect.objectContaining({ adapter: 'official', upstream_id: 'example/a' })]
    });
  });

  test('GET /v1/catalog honors cursor', async () => {
    const res = await app.request('/v1/catalog?cursor=pkg:npm/%40example/a%401.0.0', {}, env());
    const body = (await res.json()) as { items: Array<{ purl: string }> };

    expect(res.status).toBe(200);
    expect(body.items.map((item: { purl: string }) => item.purl)).toEqual([
      'pkg:npm/@example/b@1.0.0'
    ]);
  });
});
