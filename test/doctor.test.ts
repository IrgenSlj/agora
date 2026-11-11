import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';

let home: string;
let repo: string;

function cli() {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: home, AGORA_HOME: join(home, 'agora'), NO_COLOR: '1' },
      cwd: repo,
      // Hermetic: the opportunistic list refresh must never reach the network.
      fetcher: (() => Promise.reject(new Error('offline'))) as never
    }
  };
}

function cursorServers(servers: Record<string, string[]>): void {
  const mcpServers = Object.fromEntries(
    Object.entries(servers).map(([name, args]) => [name, { command: 'npx', args }])
  );
  mkdirSync(join(home, '.cursor'), { recursive: true });
  writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers }));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agora-doctor-'));
  repo = join(home, 'repo');
  mkdirSync(repo);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('agora doctor', () => {
  test('exits 0 on a machine with nothing configured', async () => {
    const { io, out } = cli();
    expect(await runCli(['doctor'], io as never)).toBe(0);
    expect(out()).toContain('hook not installed');
    expect(out()).toContain('no agora.cedar');
  });

  test('exits 1 and names the server when a configured version is revoked', async () => {
    cursorServers({ pm: ['-y', '@postman/postman-mcp-server@2.4.11'] });
    const { io, out } = cli();
    expect(await runCli(['doctor'], io as never)).toBe(1);
    expect(out()).toContain('pm (cursor) is revoked: MAL-2025-190909');
  });

  test('a fixed version of the same package is not revoked', async () => {
    cursorServers({ pm: ['-y', '@postman/postman-mcp-server@2.5.0'] });
    const { io } = cli();
    expect(await runCli(['doctor'], io as never)).toBe(0);
  });

  test('--json reports each revoked server once', async () => {
    cursorServers({ pm: ['-y', '@postman/postman-mcp-server@2.4.11'] });
    const { io, out } = cli();
    expect(await runCli(['doctor', '--json'], io as never)).toBe(1);
    const report = JSON.parse(out());
    expect(report.revocations.revoked).toHaveLength(1);
    expect(report.policy).toEqual({ path: 'agora.cedar', present: false });
  });

  test('sees agora.cedar once policy init has written it', async () => {
    const { io } = cli();
    expect(await runCli(['policy', 'init'], io as never)).toBe(0);
    const second = cli();
    await runCli(['doctor', '--json'], second.io as never);
    expect(JSON.parse(second.out()).policy.present).toBe(true);
  });
});
