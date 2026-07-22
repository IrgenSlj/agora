import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { acquirePage, seedAcquire } from '../../src/cli/pages/acquire.js';
import type { KeyEvent, PageContext } from '../../src/cli/pages/types.js';
import type { FetchLike } from '../../src/retry.js';
import { createStyler } from '../../src/ui.js';

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const strip = (s: string): string => s.replace(ANSI_RE, '');

// `acquire()` fans out to the wired federation sources
// (official/glama/pulsemcp/smithery/github/huggingface/local) plus the scan
// gate's own repo/npm reachability
// checks — ALL of them share the one `fetcher` DI seam threaded through
// AcquireInput/ScanOptions. A single stubbed fetcher keeps every test in this
// file hermetic (no live network, never hangs). `npmFail` lets one test force
// a deterministic scan FAIL (npm 404) without depending on live registry state.
function makeFetcher(opts: { npmFail?: boolean } = {}): FetchLike {
  return (async (input: string | URL) => {
    const url = String(input);
    if (opts.npmFail && url.includes('registry.npmjs.org')) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ servers: [], metadata: { count: 0 } })
    } as unknown as Response;
  }) as FetchLike;
}

function makeCtx(opts: {
  cwd: string;
  fetcher: FetchLike;
  width?: number;
  height?: number;
  color?: boolean;
  trueColor?: boolean;
}): PageContext {
  const { cwd, fetcher, width = 100, height = 32, color = true, trueColor = true } = opts;
  return {
    io: {
      stdout: { write: () => true },
      stderr: { write: () => true },
      cwd,
      env: { HOME: cwd },
      fetcher
    },
    style: createStyler(color, trueColor),
    width,
    height,
    trueColor,
    app: { user: { username: 'test' }, cwd, unread: { news: 0 } },
    repaint: () => {}
  };
}

function key(k: string): KeyEvent {
  return { raw: k, key: k, ctrl: false, shift: false, meta: false };
}

describe('Acquire page — RESOLVE → PLAN → GATE → APPLY', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agora-acquire-page-'));
  });

  test('non-fail verdict renders Resolve/Plan/Gate and offers apply, at several widths (incl. NO_COLOR)', async () => {
    for (const width of [60, 90, 130]) {
      for (const color of [true, false]) {
        const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher(), width, color, trueColor: color });
        seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
        await acquirePage.mount?.(ctx);
        const out = acquirePage.render(ctx);
        const plain = strip(out);

        expect(plain).toContain('Resolve');
        expect(plain).toContain('Plan');
        expect(plain).toContain('Gate');
        expect(plain).toMatch(/y\s+apply|y\s+accept warnings/); // apply is offered
        expect(plain).not.toContain('═'); // the FAIL-only double rule never appears

        // every line must fit the requested width, in every theme mode
        for (const line of out.split('\n')) {
          expect(strip(line).length).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test('FAIL verdict shows the double-rule banner and never offers apply', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher({ npmFail: true }) });
    seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
    await acquirePage.mount?.(ctx);
    const out = acquirePage.render(ctx);
    const plain = strip(out);

    expect(plain).toContain('FAIL');
    expect(plain).toContain('═'); // the one weighty element (§4.4)
    expect(plain).not.toMatch(/y\s+apply/);
    expect(plain).not.toContain('accept warnings');
    expect(plain).not.toContain('re-run'); // FAIL is final — no re-run hint
  });

  test('NO_COLOR strips all escape codes while the FAIL double-rule stays unambiguous', async () => {
    const ctx = makeCtx({
      cwd: dir,
      fetcher: makeFetcher({ npmFail: true }),
      color: false,
      trueColor: false
    });
    seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
    await acquirePage.mount?.(ctx);
    const out = acquirePage.render(ctx);
    expect(out).not.toContain('\x1b['); // no escape codes at all under NO_COLOR
    expect(out).toContain('FAIL');
    expect(out).toContain('═'); // double rule survives on glyph + weight alone
  });

  test('pressing y on a FAIL verdict is a no-op — never writes config', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher({ npmFail: true }) });
    seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
    await acquirePage.mount?.(ctx);
    const action = await acquirePage.handleKey(key('y'), ctx);
    expect(action).toEqual({ kind: 'none' });
    expect(existsSync(join(dir, 'opencode.json'))).toBe(false);
  });

  test('an id that resolves nowhere renders a clean not-found state (no apply, no double-rule)', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher() });
    seedAcquire({ id: 'totally-unknown-item-xyz-not-real' });
    await acquirePage.mount?.(ctx);
    const out = acquirePage.render(ctx);
    const plain = strip(out);

    expect(plain).toContain('Not found');
    expect(plain).not.toContain('═');
    expect(plain).not.toMatch(/y\s+apply/);
  });

  test('pressing / opens the resolve input line', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher() });
    seedAcquire({ id: 'mcp-filesystem' });
    await acquirePage.mount?.(ctx);
    await acquirePage.handleKey(key('/'), ctx);
    const out = strip(acquirePage.render(ctx));
    expect(out).toContain('resolve');
  });

  test('esc returns to the page that launched Acquire (returnTo)', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher() });
    seedAcquire({ id: 'mcp-filesystem', returnTo: 'search' });
    await acquirePage.mount?.(ctx);
    const action = await acquirePage.handleKey(key('esc'), ctx);
    expect(action).toEqual({ kind: 'switch', to: 'search' });
  });

  test('apply on a non-fail verdict calls the real acquire() write path and reports success', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher() });
    seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
    await acquirePage.mount?.(ctx);

    const action = await acquirePage.handleKey(key('y'), ctx);
    expect(action.kind === 'status' || action.kind === 'none').toBe(true);
    if (action.kind === 'status') {
      expect(action.tone).not.toBe('error');
      expect(action.message).toContain('Installed');
    }

    const configPath = join(dir, 'opencode.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcp?: Record<string, unknown>;
    };
    expect(config.mcp?.['mcp-filesystem']).toBeDefined();

    const out = strip(acquirePage.render(ctx));
    expect(out).toContain('Apply');
    expect(out).toContain('Installed');
  });

  test('the seeded tool selection is honored in the header and plan harness', async () => {
    const ctx = makeCtx({ cwd: dir, fetcher: makeFetcher() });
    seedAcquire({ id: 'mcp-filesystem', tool: 'opencode' });
    await acquirePage.mount?.(ctx);
    const out = strip(acquirePage.render(ctx));
    expect(out).toContain('opencode');
  });
});
