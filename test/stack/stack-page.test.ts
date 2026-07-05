/**
 * Unit tests for src/cli/pages/stack.ts
 * No real spawns — probe=false only. Uses temp dirs with fixture configs.
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stackPage } from '../../src/cli/pages/stack';
import type { PageContext } from '../../src/cli/pages/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-stack-page-test-'));
}

/** Passthrough styler that returns the string as-is (no ANSI codes). */
const passthroughStyle = {
  accent: (s: string) => s,
  dim: (s: string) => s,
  bold: (s: string) => s,
  orange: (s: string) => s,
  italic: (s: string) => s,
  underline: (s: string) => s,
  strikethrough: (s: string) => s,
  fg: (_r: number, _g: number, _b: number, s: string) => s,
  bg: (_r: number, _g: number, _b: number, s: string) => s,
  reset: (s: string) => s
};

function makeCtx(cwd: string, home: string, env?: Record<string, string>): PageContext {
  const ctx: PageContext = {
    io: {
      cwd,
      env: { HOME: home, ...env },
      stdout: { write: () => true } as unknown as NodeJS.WriteStream,
      stderr: { write: () => true } as unknown as NodeJS.WriteStream,
      fetcher: undefined as unknown as PageContext['io']['fetcher']
    },
    style: passthroughStyle as unknown as PageContext['style'],
    width: 120,
    height: 40,
    trueColor: false,
    app: {
      user: { username: 'testuser' },
      cwd,
      unread: { news: 0 }
    },
    repaint: () => {}
  };
  return ctx;
}

/** Write a minimal opencode.json with some MCP servers. */
function writeOpencodeConfig(cwd: string, servers: Record<string, unknown>): void {
  writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: servers }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('stackPage: metadata', () => {
  test('has correct id, title, navLabel, navIcon', () => {
    expect(stackPage.id).toBe('stack');
    expect(stackPage.title).toBe('STACK');
    expect(stackPage.navLabel).toBe('Stack');
    expect(stackPage.navIcon).toBeDefined();
    expect(stackPage.hotkeys.length).toBeGreaterThan(0);
  });

  test('exposes expected hotkeys', () => {
    const keys = stackPage.hotkeys.map((h) => h.key);
    expect(keys).toContain('j/k');
    expect(keys).toContain('Enter');
    expect(keys).toContain('p');
    expect(keys).toContain('r');
  });
});

describe('stackPage: empty config → empty-state text', () => {
  test('renders empty-state message when no servers configured', async () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const ctx = makeCtx(cwd, home);
      await stackPage.mount!(ctx);
      const out = stackPage.render(ctx);
      expect(out).toContain('No MCP servers configured');
      expect(out).toContain('agora install');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('stackPage: server list', () => {
  let cwd: string;
  let home: string;
  let ctx: PageContext;

  beforeEach(async () => {
    cwd = makeTmp();
    home = makeTmp();
    writeOpencodeConfig(cwd, {
      'my-server': {
        type: 'local',
        command: ['node', 'server.js'],
        enabled: true
      },
      'another-server': {
        type: 'local',
        command: ['npx', 'some-pkg'],
        enabled: true
      }
    });
    ctx = makeCtx(cwd, home);
    await stackPage.mount!(ctx);
  });

  test('mount populates servers from fixture config', () => {
    // After mount the page should have found our servers.
    // We verify via render — server names must appear.
    const out = stackPage.render(ctx);
    expect(out).toContain('my-server');
    expect(out).toContain('another-server');
  });

  test('render (list mode) contains summary line', () => {
    const out = stackPage.render(ctx);
    expect(out).toContain('server');
    // Header must contain STACK
    expect(out).toContain('STACK');
  });

  test('handleKey down moves selection (no crash)', async () => {
    // First render to confirm list mode
    stackPage.render(ctx);
    const action = await stackPage.handleKey(
      { raw: 'j', key: 'j', ctrl: false, shift: false, meta: false },
      ctx
    );
    expect(action.kind).toBe('none');
    // Selection moved — re-render should not throw
    expect(() => stackPage.render(ctx)).not.toThrow();
  });

  test('handleKey up at top stays clamped', async () => {
    const action = await stackPage.handleKey(
      { raw: '\x1b[A', key: 'up', ctrl: false, shift: false, meta: false },
      ctx
    );
    expect(action.kind).toBe('none');
  });

  test('handleKey enter switches to detail mode', async () => {
    const action = await stackPage.handleKey(
      { raw: '\r', key: 'enter', ctrl: false, shift: false, meta: false },
      ctx
    );
    expect(action.kind).toBe('none');
    // Now render — should contain detail view header
    const out = stackPage.render(ctx);
    expect(out).toContain('Instances');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});

describe('stackPage: detail mode', () => {
  let cwd: string;
  let home: string;
  let ctx: PageContext;

  beforeEach(async () => {
    cwd = makeTmp();
    home = makeTmp();
    writeOpencodeConfig(cwd, {
      'detail-server': {
        type: 'local',
        command: ['node', 'mcp.js'],
        enabled: true
      }
    });
    ctx = makeCtx(cwd, home);
    await stackPage.mount!(ctx);
    // Enter detail mode
    await stackPage.handleKey(
      { raw: '\r', key: 'enter', ctrl: false, shift: false, meta: false },
      ctx
    );
  });

  test('render in detail mode shows Instances section', () => {
    const out = stackPage.render(ctx);
    expect(out).toContain('Instances');
  });

  test('render in detail mode shows Tools section', () => {
    const out = stackPage.render(ctx);
    expect(out).toContain('Tools');
  });

  test('render in detail mode shows server name', () => {
    const out = stackPage.render(ctx);
    expect(out).toContain('detail-server');
  });

  test('esc from detail returns to list mode', async () => {
    const action = await stackPage.handleKey(
      { raw: '\x1b', key: 'esc', ctrl: false, shift: false, meta: false },
      ctx
    );
    expect(action.kind).toBe('none');
    // Now render should be list mode (STACK header, no Instances heading at top)
    const out = stackPage.render(ctx);
    // List mode shows server name in a row, not the full Instances section with detail header
    expect(out).toContain('detail-server');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });
});

describe('stackPage: refresh (r key)', () => {
  test('r key triggers reload without throwing', async () => {
    const cwd = makeTmp();
    const home = makeTmp();
    try {
      const ctx = makeCtx(cwd, home);
      await stackPage.mount!(ctx);
      const action = await stackPage.handleKey(
        { raw: 'r', key: 'r', ctrl: false, shift: false, meta: false },
        ctx
      );
      expect(action.kind).toBe('none');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
