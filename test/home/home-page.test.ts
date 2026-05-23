/**
 * Integration-level tests for the home page TUI (src/cli/pages/home.ts).
 * Kept fully offline — community will show its "sign in" hint (no network),
 * trending uses in-process sample data.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { homePage } from '../../src/cli/pages/home';
import { createStyler } from '../../src/ui';
import { vlen } from '../../src/cli/pages/helpers';
import { writeCapabilityCache } from '../../src/stack/capability-cache';
import { writeCache } from '../../src/news/cache';
import type { PageContext, KeyEvent, AppState } from '../../src/cli/pages/types';
import type { ServerCapabilities } from '../../src/stack/capability-cache';
import type { NewsItem } from '../../src/news/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTool(name: string) {
  return { name, description: '', inputSchema: { type: 'object' as const, properties: {} } };
}

function makeCtx(opts: {
  tmp: string;
  width?: number;
  height?: number;
  opencodeCfg?: Record<string, unknown>;
}): PageContext & { repaints: number } {
  const { tmp, width = 120, height = 40 } = opts;

  // Write opencode.json if requested
  if (opts.opencodeCfg) {
    writeFileSync(join(tmp, 'opencode.json'), JSON.stringify(opts.opencodeCfg));
  }

  const style = createStyler(false); // plain — no ANSI, easier to assert

  let repaints = 0;

  const ctx = {
    io: {
      stdout: { write: () => {} } as any,
      stderr: { write: () => {} } as any,
      env: {
        HOME: tmp,
        AGORA_HOME: tmp, // point data dir at tmp so no real ~/.config reads
        PATH: process.env.PATH ?? ''
      },
      cwd: tmp
    },
    style,
    width,
    height,
    trueColor: false,
    app: {
      user: {},
      cwd: tmp,
      unread: { news: 0, community: 0 }
    } as AppState,
    repaint() {
      repaints++;
    },
    get repaints() {
      return repaints;
    }
  };
  return ctx as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('home page: Your stack band — no servers', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  test('shows friendly message when no servers configured', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    // Give the async refreshFeed a chance to settle
    await new Promise((r) => setTimeout(r, 50));

    const output = homePage.render(ctx);
    expect(output).toContain('Your stack');
    expect(output).toContain('No MCP servers configured yet');
  });

  test('shows getting-started opportunity', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 50));

    const output = homePage.render(ctx);
    // The getting-started opportunity has command "agora search"
    expect(output).toMatch(/agora search/);
  });
});

describe('home page: Your stack band — with servers', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  test('shows server count from opencode.json + capability cache', async () => {
    // Write a minimal opencode.json with one MCP server
    const cfg = {
      mcp: {
        'my-test-server': {
          type: 'local',
          command: ['node', 'server.js'],
          enabled: true
        }
      }
    };

    // Write a seeded capability cache
    const caps: ServerCapabilities[] = [
      {
        key: 'my-test-server@abc12345',
        name: 'my-test-server',
        command: ['node', 'server.js'],
        tools: [makeTool('tool_a'), makeTool('tool_b')],
        ok: true,
        probedAt: new Date().toISOString()
      }
    ];
    writeCapabilityCache(tmp, caps);

    const ctx = makeCtx({ tmp, opencodeCfg: cfg });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 100));

    const output = homePage.render(ctx);
    expect(output).toContain('Your stack');
    // Should mention 1 server
    expect(output).toMatch(/1\s*servers?/);
  });
});

describe('home page: Trending lens toggle', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  test('initial render contains "Trending" section', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    const output = homePage.render(ctx);
    expect(output).toContain('Trending');
  });

  test('pressing t toggles lens from hot to top', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    resetToLens(ctx, 'Hot');
    const before = homePage.render(ctx);
    expect(before).toContain('Hot');

    const action = homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    expect(action).toEqual({ kind: 'status', message: 'trending: top' });

    const after = homePage.render(ctx);
    expect(after).toContain('Top');
    expect(after).not.toContain('Hot');
  });

  test('pressing t three times returns to original lens (full cycle)', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Normalize to Hot first
    resetToLens(ctx, 'Hot');

    // Three presses complete the cycle: hot → top → repos → hot
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);

    const output = homePage.render(ctx);
    // After three toggles from Hot we should be back at Hot
    expect(output).toContain('Hot');
  });
});

describe('home page: narrow width', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  test('renders at width=70 without throwing', async () => {
    const ctx = makeCtx({ tmp, width: 70, height: 30 });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    let output: string;
    expect(() => {
      output = homePage.render(ctx);
    }).not.toThrow();

    // No line should visually exceed width (frame pads/truncates to width)
    for (const line of output!.split('\n')) {
      expect(vlen(line)).toBeLessThanOrEqual(70);
    }
  });
});

describe('home page: hotkeys', () => {
  test('t key is in hotkeys list', () => {
    const keys = homePage.hotkeys?.map((h) => h.key);
    expect(keys).toContain('t');
    const tKey = homePage.hotkeys?.find((h) => h.key === 't');
    expect(tKey?.label).toBe('hot/top/repos');
  });

  test('r also triggers feed refresh (no throw)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
    try {
      const ctx = makeCtx({ tmp });
      expect(() => {
        homePage.handleKey!({ key: 'r' } as KeyEvent, ctx);
      }).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/** Press `t` up to 3 times until the render contains the target lens label. */
function resetToLens(ctx: PageContext & { repaints: number }, target: string): void {
  for (let i = 0; i < 3; i++) {
    const out = homePage.render(ctx);
    // Check that ONLY this target appears in the Trending title (use a regex to be specific)
    if (new RegExp('Trending.*·.*' + target, 'i').test(out)) break;
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
  }
}

describe('home page: 3-way lens cycle', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  test('t cycles Hot → Top → Repos → Hot (title text each step)', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Ensure we start on Hot
    resetToLens(ctx, 'Hot');

    // Initial: Hot
    const step0 = homePage.render(ctx);
    expect(step0).toContain('Hot');

    // Press t → Top
    const action1 = homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    expect(action1).toEqual({ kind: 'status', message: 'trending: top' });
    const step1 = homePage.render(ctx);
    expect(step1).toContain('Top');
    expect(step1).not.toContain('Repos');

    // Press t → Repos
    const action2 = homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    expect(action2).toEqual({ kind: 'status', message: 'trending: repos' });
    const step2 = homePage.render(ctx);
    expect(step2).toContain('Repos');

    // Press t → back to Hot
    const action3 = homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    expect(action3).toEqual({ kind: 'status', message: 'trending: hot' });
    const step3 = homePage.render(ctx);
    expect(step3).toContain('Hot');
  });
});

describe('home page: Repos lens', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agora-home-test-'));
  });

  function makeGhNewsItem(repoPath: string, engagement: number): NewsItem {
    const [owner] = repoPath.split('/');
    return {
      id: `gh:${repoPath.replace('/', '-')}`,
      source: 'github-trending',
      title: repoPath,
      url: `https://github.com/${repoPath}`,
      author: owner,
      publishedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      engagement,
      tags: ['ai', 'mcp']
    };
  }

  test('renders cached repos in Repos lens', async () => {
    // Seed the news cache with github-trending items
    const items: NewsItem[] = [
      makeGhNewsItem('acme/fast-agent', 1200),
      makeGhNewsItem('corp/mcp-server', 800)
    ];
    writeCache(tmp, items);

    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Normalize to hot, then switch to repos lens
    resetToLens(ctx, 'Hot');
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // hot → top
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // top → repos

    const output = homePage.render(ctx);
    expect(output).toContain('Repos');
    expect(output).toContain('acme/fast-agent');
    expect(output).toContain('corp/mcp-server');
  });

  test('shows never-dead hint when no github-trending cache', async () => {
    // No cache written; tmp dir is empty
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Normalize to hot, then switch to repos lens
    resetToLens(ctx, 'Hot');
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // hot → top
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // top → repos

    const output = homePage.render(ctx);
    expect(output).toContain('Repos');
    expect(output).toContain('agora news --refresh');
  });

  test('no line exceeds width in Repos lens', async () => {
    const items: NewsItem[] = [
      makeGhNewsItem('very-long-org-name/very-long-repo-name-that-might-overflow', 500),
      makeGhNewsItem('another/repo', 300)
    ];
    writeCache(tmp, items);

    const ctx = makeCtx({ tmp, width: 120, height: 40 });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Normalize to hot, then switch to repos lens
    resetToLens(ctx, 'Hot');
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // hot → top
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx); // top → repos

    const output = homePage.render(ctx);
    for (const line of output.split('\n')) {
      expect(vlen(line)).toBeLessThanOrEqual(120);
    }
  });
});

// Cleanup after each test (best-effort)
// Note: beforeEach creates tmp; we clean up here per describe block
// For simplicity just leave them to OS cleanup; or add afterEach via a shared ref.
// The mkdtempSync dirs are small and bun test is short-lived.
