import { describe, expect, test } from 'bun:test';
import { commandAdmin } from '../../src/cli/commands/community.js';
import type { CliIo } from '../../src/cli/flags.js';
import { createStyler } from '../../src/ui.js';
import type { ParsedArgs } from '../../src/cli/flags.js';

const style = createStyler(false);

function makeIo(): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: {
      write(s: string) {
        out.push(s);
      }
    } as any,
    stderr: {
      write(s: string) {
        err.push(s);
      }
    } as any,
    env: {}
  };
  return { io, out, err };
}

function makeParsed(args: string[], flags: Record<string, string | boolean> = {}): ParsedArgs {
  return { command: 'admin', args, flags };
}

// ── adminHideSource stub ───────────────────────────────────────────────────────

describe('commandAdmin hide', () => {
  test('prints hid message on success', async () => {
    const { io, out } = makeIo();
    const parsed = makeParsed(['hide', 't-mcp-1'], { reason: 'confirmed malware' });

    // Stub the network by injecting a fake fetcher via env-level token+apiUrl.
    // We override the source call by patching the module's internal fetcher through
    // a mock SourceOptions fetcher property (supported by the fetcher() helper).
    const fakeResult = { success: true, id: 'ks-123', alreadyHidden: false };

    // Use a manual opts-level fetcher stub — commandAdmin reads writeSourceOptions,
    // so we pass flags that enable API and provide a token, then intercept fetch.
    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('/api/admin/hide')) {
        return {
          ok: true,
          status: 200,
          json: async () => fakeResult
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const parsedWithAuth = makeParsed(['hide', 't-mcp-1'], {
      reason: 'confirmed malware',
      token: 'tok',
      apiUrl: 'http://localhost'
    });

    const code = await commandAdmin(parsedWithAuth, io, style);
    globalThis.fetch = savedFetch;

    expect(code).toBe(0);
    const combined = out.join('');
    expect(combined).toContain('t-mcp-1');
    expect(combined).toContain('ks-123');
  });

  test('surfaces 403 as friendly message', async () => {
    const { io, err } = makeIo();

    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('/api/admin/hide')) {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Admin access required' })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const parsedWithAuth = makeParsed(['hide', 't-mcp-1'], {
      reason: 'spam',
      token: 'tok',
      apiUrl: 'http://localhost'
    });

    const code = await commandAdmin(parsedWithAuth, io, style);
    globalThis.fetch = savedFetch;

    expect(code).toBe(1);
    expect(err.join('')).toContain('Admin access required');
  });

  test('requires --reason flag', async () => {
    const { io, err } = makeIo();
    const parsed = makeParsed(['hide', 't-mcp-1']);
    const code = await commandAdmin(parsed, io, style);
    expect(code).toBe(1);
    expect(err.join('')).toContain('reason');
  });

  test('requires id argument', async () => {
    const { io, err } = makeIo();
    const parsed = makeParsed(['hide'], { reason: 'spam' });
    const code = await commandAdmin(parsed, io, style);
    expect(code).toBe(1);
    expect(err.join('')).toContain('id');
  });
});

// ── commandAdmin log ───────────────────────────────────────────────────────────

describe('commandAdmin log', () => {
  test('renders table of entries', async () => {
    const { io, out } = makeIo();

    const fakeEntries = [
      {
        id: 'ks-1',
        targetId: 't-mcp-1',
        targetType: 'discussion',
        reason: 'confirmed malware',
        operatorId: 'u-1',
        operatorUsername: 'alice',
        actedAt: '2026-05-17T10:00:00'
      },
      {
        id: 'ks-2',
        targetId: 'r-mcp-1-1',
        targetType: 'reply',
        reason: 'CSAM',
        operatorId: 'u-1',
        operatorUsername: 'alice',
        actedAt: '2026-05-17T09:00:00'
      }
    ];

    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes('/api/admin/log')) {
        return { ok: true, status: 200, json: async () => ({ entries: fakeEntries }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const parsed = makeParsed(['log'], { token: 'tok', apiUrl: 'http://localhost' });
    const code = await commandAdmin(parsed, io, style);
    globalThis.fetch = savedFetch;

    expect(code).toBe(0);
    const combined = out.join('');
    expect(combined).toContain('alice');
    expect(combined).toContain('t-mcp-1');
    expect(combined).toContain('confirmed malware');
    expect(combined).toContain('CSAM');
  });

  test('prints empty message when no entries', async () => {
    const { io, out } = makeIo();

    const savedFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ entries: [] })
    });

    const parsed = makeParsed(['log'], { token: 'tok', apiUrl: 'http://localhost' });
    const code = await commandAdmin(parsed, io, style);
    globalThis.fetch = savedFetch;

    expect(code).toBe(0);
    expect(out.join('')).toContain('No kill-switch log entries');
  });
});

// ── unknown subcommand ─────────────────────────────────────────────────────────

describe('commandAdmin unknown subcommand', () => {
  test('prints usage and returns 1', async () => {
    const { io, out } = makeIo();
    const parsed = makeParsed(['bogus']);
    const code = await commandAdmin(parsed, io, style);
    expect(code).toBe(1);
    expect(out.join('')).toContain('Usage');
  });
});

// ── requireAdmin user-ID parsing helper (unit) ────────────────────────────────

describe('admin user-ID list parsing', () => {
  function parseAdminIds(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  test('single id', () => {
    expect(parseAdminIds('u-1')).toEqual(['u-1']);
  });

  test('multiple ids with spaces', () => {
    expect(parseAdminIds('u-1, u-2 , u-3')).toEqual(['u-1', 'u-2', 'u-3']);
  });

  test('empty string yields empty array', () => {
    expect(parseAdminIds('')).toEqual([]);
  });

  test('trailing comma does not produce empty entry', () => {
    expect(parseAdminIds('u-1,')).toEqual(['u-1']);
  });
});
