import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli/app';
import type { NewsItem } from '../src/news/types';

function createIo(
  cwd = process.cwd(),
  options: { env?: Record<string, string | undefined> } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: options.env ?? {},
      cwd
    },
    stdout,
    stderr
  };
}

function writeNewsCache(dataDir: string, items: NewsItem[]): void {
  mkdirSync(dataDir, { recursive: true });
  const lines = items.map((i) => JSON.stringify(i));
  writeFileSync(join(dataDir, 'news-cache.jsonl'), lines.join('\n') + '\n', 'utf8');
}

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    id: 'test-1',
    source: 'hn',
    title: 'Test news item',
    url: 'https://example.com/test',
    publishedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    engagement: 100,
    tags: ['mcp', 'ai'],
    ...overrides
  };
}

describe('agora today', () => {
  test('--json returns object with at, news, threads, trending keys', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-today-'));
    const dataDir = join(temp, 'data');
    writeNewsCache(dataDir, [makeNewsItem()]);
    const { io, stdout } = createIo(temp, { env: { AGORA_API_URL: '', AGORA_TOKEN: '' } });

    try {
      const code = await runCli(['today', '--json', '--data-dir', dataDir], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(typeof payload.at).toBe('string');
      expect(Array.isArray(payload.news)).toBe(true);
      expect(Array.isArray(payload.threads)).toBe(true);
      expect(Array.isArray(payload.trending)).toBe(true);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--section news --json includes news, omits others', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-today-'));
    const dataDir = join(temp, 'data');
    writeNewsCache(dataDir, [makeNewsItem()]);
    const { io, stdout } = createIo(temp, { env: { AGORA_API_URL: '', AGORA_TOKEN: '' } });

    try {
      const code = await runCli(['today', '--section', 'news', '--json', '--data-dir', dataDir], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(Array.isArray(payload.news)).toBe(true);
      expect(payload.threads).toBeUndefined();
      expect(payload.trending).toBeUndefined();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('default render shows expected section headers', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-today-'));
    const dataDir = join(temp, 'data');
    writeNewsCache(dataDir, [makeNewsItem()]);
    const { io, stdout } = createIo(temp, { env: { AGORA_API_URL: '', AGORA_TOKEN: '' } });

    try {
      const code = await runCli(['today', '--data-dir', dataDir], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('News');
      expect(out).toContain('Community');
      expect(out).toContain('Trending');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('empty news cache shows dim "Nothing in the last 24h." line', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-today-'));
    const dataDir = join(temp, 'data');
    mkdirSync(dataDir, { recursive: true });
    const { io, stdout } = createIo(temp, { env: { AGORA_API_URL: '', AGORA_TOKEN: '' } });

    try {
      const code = await runCli(['today', '--section', 'news', '--data-dir', dataDir], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('Nothing in the last 24h.');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('no backend configured shows hint in community section', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-today-'));
    const dataDir = join(temp, 'data');
    mkdirSync(dataDir, { recursive: true });
    const { io, stdout } = createIo(temp, { env: { AGORA_API_URL: '', AGORA_TOKEN: '' } });

    try {
      const code = await runCli(['today', '--section', 'community', '--data-dir', dataDir], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('agora auth login');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
