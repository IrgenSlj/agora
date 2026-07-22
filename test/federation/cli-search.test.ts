import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli/app';
import type { FetchLike } from '../../src/retry';

const FIXTURES_DIR = join(import.meta.dirname, '../fixtures/federation');

function loadFixture(name: string): { servers: unknown[] } {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
}

function pageFetcher(servers: unknown[]): FetchLike {
  return async () =>
    new Response(JSON.stringify({ servers, metadata: { count: servers.length } }), { status: 200 });
}

function createIo(fetcher: FetchLike, dataDir: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (c: string) => stdout.push(c) },
      stderr: { write: (c: string) => stderr.push(c) },
      env: { AGORA_HOME: dataDir },
      cwd: process.cwd(),
      fetcher
    },
    stdout,
    stderr
  };
}

describe('agora search --json — federated shape', () => {
  test('emits merged FederatedItem[] with provenance and per-source statuses', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const fixture = loadFixture('official-search-postgres.json');
      const { io, stdout } = createIo(pageFetcher(fixture.servers), dataDir);

      const code = await runCli(['search', 'postgres', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.query).toBe('postgres');
      expect(payload.source).toBe('all');
      expect(Array.isArray(payload.statuses)).toBe(true);
      expect(payload.statuses.map((s: { source: string }) => s.source).sort()).toEqual([
        'github',
        'glama',
        'huggingface',
        'local',
        'official',
        'smithery'
      ]);
      expect(payload.statuses.every((s: { state: string }) => s.state === 'ok')).toBe(true);
      expect(payload.count).toBe(payload.items.length);
      expect(payload.items.length).toBeGreaterThan(0);

      for (const item of payload.items) {
        expect(Array.isArray(item.provenance)).toBe(true);
        expect(item.provenance.length).toBeGreaterThan(0);
      }
      expect(
        payload.items.some((i: { provenance: { source: string }[] }) =>
          i.provenance.some((p) => p.source === 'official')
        )
      ).toBe(true);
      expect(
        payload.items.some((i: { provenance: { source: string }[] }) =>
          i.provenance.some((p) => p.source === 'local')
        )
      ).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('--source official restricts results and statuses to the official registry', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const fixture = loadFixture('official-search-postgres.json');
      const { io, stdout } = createIo(pageFetcher(fixture.servers), dataDir);

      const code = await runCli(['search', 'postgres', '--source', 'official', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.source).toBe('official');
      expect(payload.statuses.length).toBe(1);
      expect(payload.statuses[0].source).toBe('official');
      expect(
        payload.items.every((i: { provenance: { source: string }[] }) =>
          i.provenance.every((p) => p.source === 'official')
        )
      ).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('rejects an unknown --source value', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const { io, stderr } = createIo(pageFetcher([]), dataDir);
      const code = await runCli(['search', 'postgres', '--source', 'bogus'], io);
      expect(code).toBe(2);
      expect(stderr.join('')).toContain('Unknown --source');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // github/huggingface reuse src/hubs/*.ts, which retries each of their own
  // several sequential sub-requests with a real (non-signal-aware) backoff
  // delay — a fully-down network can legitimately ride the engine's own
  // per-source timeout ceiling (DEFAULT_TIMEOUT_MS = 5000) instead of
  // failing instantly. Headroom above that ceiling instead of racing bun's
  // default 5000ms.
  test('offline fallback — a throwing fetcher still returns local results honestly', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const throwingFetcher: FetchLike = async () => {
        throw new Error('network down');
      };
      const { io, stdout, stderr } = createIo(throwingFetcher, dataDir);

      const code = await runCli(['search', 'github', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.statuses.find((s: { source: string }) => s.source === 'official').state).toBe(
        'unreachable'
      );
      expect(payload.items.some((i: { id: string }) => i.id === 'mcp-github')).toBe(true);
      expect(stderr.join('')).toContain('official unreachable');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);
});

describe('agora refresh', () => {
  test('--json reports incremental sync counts and persists the cache', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const fixture = loadFixture('official-search-postgres.json');
      const { io, stdout } = createIo(pageFetcher(fixture.servers), dataDir);

      const code = await runCli(['refresh', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.source).toBe('official');
      expect(payload.added).toBe(5);
      expect(payload.total).toBe(5);
      expect(payload.error).toBeUndefined();

      // A second run against a live cache with the same page is a no-op sync.
      const { io: io2, stdout: stdout2 } = createIo(pageFetcher(fixture.servers), dataDir);
      const code2 = await runCli(['refresh', '--json'], io2);
      const payload2 = JSON.parse(stdout2.join(''));
      expect(code2).toBe(0);
      expect(payload2.updated).toBe(5);
      expect(payload2.added).toBe(0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test('rejects --source values other than official', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'agora-federation-cli-'));
    try {
      const { io, stderr } = createIo(pageFetcher([]), dataDir);
      const code = await runCli(['refresh', '--source', 'local'], io);
      expect(code).toBe(2);
      expect(stderr.join('')).toContain('only supports --source official');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
