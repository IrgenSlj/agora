import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';

// `agora audit` is the command that demonstrates why Agora exists, so the
// things worth pinning are not the happy path — they are the four ways a
// reporting tool can quietly overstate what it knows.

let dir: string;

function config(mcp: Record<string, unknown>): void {
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp })
  );
}

function io(fetcher?: typeof globalThis.fetch) {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: dir },
      cwd: dir,
      ...(fetcher ? { fetcher } : {})
    }
  };
}

const advisory = (id: string, severity: string) => ({
  id,
  summary: `${id} summary`,
  database_specific: { severity }
});

const respond = (vulns: unknown[]) =>
  Promise.resolve(new Response(JSON.stringify({ vulns }), { status: 200 }));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-audit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agora audit', () => {
  test('a HIGH advisory is reported and exits non-zero so CI can gate on it', async () => {
    config({ fs: { type: 'local', command: ['npx', '@scope/server@1.0.0'], enabled: true } });
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-x', 'HIGH')])) as never);

    const code = await runCli(['audit'], cliIo as never);

    expect(code).toBe(1);
    expect(out()).toContain('GHSA-x');
    expect(out()).toContain('HIGH');
  });

  test('a MODERATE advisory is reported but does not fail the command', async () => {
    // Reporting and blocking are different decisions. Failing a build on every
    // moderate advisory trains people to pass --force, which costs more than it
    // saves.
    config({ fs: { type: 'local', command: ['npx', '@scope/server@1.0.0'], enabled: true } });
    const { io: cliIo, out } = io((() => respond([advisory('GHSA-y', 'MODERATE')])) as never);

    expect(await runCli(['audit'], cliIo as never)).toBe(0);
    expect(out()).toContain('GHSA-y');
  });

  test('an unreachable OSV is reported as unchecked, never as clean', async () => {
    // The failure that would matter most: on an outage, a tool that reports
    // "no advisories" hands out a clean bill of health it never established.
    config({ fs: { type: 'local', command: ['npx', '@scope/server@1.0.0'], enabled: true } });
    const down = (() => Promise.reject(new Error('ECONNREFUSED'))) as never;
    const { io: cliIo, out } = io(down);

    await runCli(['audit'], cliIo as never);

    expect(out()).toContain('could not be checked');
    expect(out()).toContain('Not checked is not the same as clean');
    expect(out()).not.toContain('No published advisories');
  });

  test('a server that cannot be identified is counted separately, not as clean', async () => {
    // A remote server or a custom launcher has not been checked. Folding it
    // into the scanned count would inflate the reassurance.
    config({
      remote: { type: 'remote', url: 'https://example.com/mcp', enabled: true },
      custom: { type: 'local', command: ['/opt/bin/my-server'], enabled: true }
    });
    const { io: cliIo, out } = io((() => respond([])) as never);

    await runCli(['audit', '--json'], cliIo as never);
    const payload = JSON.parse(out());

    expect(payload.scanned).toBe(0);
    expect(payload.unidentifiable).toBeGreaterThan(0);
  });

  test('a clean result still says what it does not mean', async () => {
    config({ fs: { type: 'local', command: ['npx', '@scope/server@1.0.0'], enabled: true } });
    const { io: cliIo, out } = io((() => respond([])) as never);

    expect(await runCli(['audit'], cliIo as never)).toBe(0);
    expect(out()).toContain('No published advisories');
    expect(out()).toContain('is not "safe"');
  });

  test('malware blocks regardless of any severity label', async () => {
    config({ bad: { type: 'local', command: ['npx', 'evil-pkg@1.0.0'], enabled: true } });
    const { io: cliIo, out } = io((() =>
      respond([{ id: 'MAL-2026-1', summary: 'malware' }])) as never);

    expect(await runCli(['audit'], cliIo as never)).toBe(1);
    expect(out()).toContain('MALWARE');
  });
});
