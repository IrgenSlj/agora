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
import type { PageContext, KeyEvent, AppState } from '../../src/cli/pages/types';
import type { ServerCapabilities } from '../../src/stack/capability-cache';

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

    const before = homePage.render(ctx);
    expect(before).toContain('Hot');

    const action = homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    expect(action).toEqual({ kind: 'status', message: 'trending: top' });

    const after = homePage.render(ctx);
    expect(after).toContain('Top');
    expect(after).not.toContain('Hot');
  });

  test('pressing t twice returns to original lens', async () => {
    const ctx = makeCtx({ tmp });
    homePage.mount!(ctx);
    await new Promise((r) => setTimeout(r, 30));

    // Record starting lens via first render
    const start = homePage.render(ctx);
    const startedOnHot = start.includes('Hot');

    // Toggle once, then toggle back
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);
    homePage.handleKey!({ key: 't' } as KeyEvent, ctx);

    const output = homePage.render(ctx);
    // After two toggles we should be back where we started
    if (startedOnHot) {
      expect(output).toContain('Hot');
    } else {
      expect(output).toContain('Top');
    }
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
    expect(tKey?.label).toBe('hot/top');
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

// Cleanup after each test (best-effort)
// Note: beforeEach creates tmp; we clean up here per describe block
// For simplicity just leave them to OS cleanup; or add afterEach via a shared ref.
// The mkdtempSync dirs are small and bun test is short-lived.
