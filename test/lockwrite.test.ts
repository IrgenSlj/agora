import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { type Lockfile, parseLockfile } from '../src/model/lockfile';
import { capabilityKey } from '../src/stack/capability-cache';

// Until this landed, the drift plane was inert end to end: nothing wrote a
// lockfile and nothing populated the manifests `lock verify` compares against,
// so `agora ci` answered "not established" for the one question that is the
// whole product. These tests exist to keep it reachable, and to keep it honest
// about the fields it cannot establish.

let dir: string;
let dataDir: string;

const COMMAND = ['npx', '-y', '@scope/server@1.2.3'];
const PURL = 'pkg:npm/%40scope/server@1.2.3';

function config(): void {
  writeFileSync(
    join(dir, 'opencode.json'),
    JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      mcp: { demo: { type: 'local', command: COMMAND, enabled: true } }
    })
  );
}

function baseline(over: Record<string, unknown> = {}): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'capabilities.json'),
    JSON.stringify([
      {
        key: capabilityKey('demo', COMMAND),
        name: 'demo',
        command: COMMAND,
        ok: true,
        probedAt: new Date().toISOString(),
        descriptionDigest: 'baseline-digest',
        tools: [
          { name: 'echo', description: 'Echo a message', inputSchema: { type: 'object' } },
          { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object' } }
        ],
        ...over
      }
    ])
  );
}

/**
 * Every fetch in this suite is refused.
 *
 * `lock write` resolves tarballs by default, and a test that reaches
 * registry.npmjs.org is not hermetic: it fails on a plane, it is slow, and it
 * silently depends on a package existing. A rejecting fetcher also exercises
 * the path that matters most — the tarball hash being *absent with a reason*
 * rather than the whole command failing.
 */
const refuseFetch = (() => Promise.reject(new Error('offline in tests'))) as never;

function io() {
  const out: string[] = [];
  return {
    out: () => out.join(''),
    io: {
      fetcher: refuseFetch,
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: {
        HOME: dir,
        NO_COLOR: '1',
        AGORA_HOME: dataDir,
        AGORA_DB_PATH: join(dir, 'agora.db')
      },
      cwd: dir
    }
  };
}

const readLock = (): Lockfile => parseLockfile(readFileSync(join(dir, 'agora.lock'), 'utf8'));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agora-lockwrite-'));
  dataDir = join(dir, '.agora');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('agora lock write', () => {
  test('an unreachable registry leaves the hash absent with a reason, not a failed lock', async () => {
    // Byte resolution is a signal, not a precondition. Losing it must not cost
    // the drift baseline that the declared tools already provide.
    config();
    baseline();
    const { io: cliIo, out } = io();

    expect(await runCli(['lock', 'write'], cliIo as never)).toBe(0);
    expect(readLock().artifacts).toHaveLength(1);
    expect(readLock().artifacts[0]?.integrity.tarball_sha256).toBeUndefined();
    expect(out()).toContain('without a tarball hash');
    expect(out()).toContain('still drift-checked on declared tools');
  });

  test('--no-fetch skips byte resolution and says why the hash is absent', async () => {
    config();
    baseline();
    const { io: cliIo, out } = io();

    expect(await runCli(['lock', 'write', '--no-fetch'], cliIo as never)).toBe(0);
    expect(readLock().artifacts[0]?.integrity.tarball_sha256).toBeUndefined();
    expect(out()).toContain('byte resolution not requested');
  });

  test('pins the approved baseline, and lock verify then passes', async () => {
    config();
    baseline();

    expect(await runCli(['lock', 'write', '--no-fetch'], io().io as never)).toBe(0);

    const lock = readLock();
    expect(lock.artifacts).toHaveLength(1);
    expect(lock.artifacts[0]?.purl).toBe(PURL);
    expect(lock.artifacts[0]?.tools.map((t) => t.name)).toEqual(['add', 'echo']);

    // The lockfile and the manifests it verifies against are written together;
    // either alone is inert, which is exactly how this was broken before.
    expect(await runCli(['lock', 'verify'], io().io as never)).toBe(0);
  });

  test('leaves unestablished fields absent rather than filling them in', async () => {
    // The whole point of the file. A plausible-looking tarball hash or an
    // `allow` verdict nobody evaluated would be a fabricated record in the one
    // file whose entire job is being the trustworthy one.
    config();
    baseline();
    await runCli(['lock', 'write', '--no-fetch'], io().io as never);

    const raw = JSON.parse(readFileSync(join(dir, 'agora.lock'), 'utf8'));
    const entry = raw.artifacts[0];
    expect(entry.integrity.tarball_sha256).toBeUndefined();
    expect(entry.policy_verdict).toBeUndefined();
    expect(entry.provenance.verified).toBe(false);
    expect(entry.integrity.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a server with no probe baseline is skipped with a reason, never silently', async () => {
    // A server missing from the lockfile is a server the tripwire will not
    // watch. Omitting it quietly would leave the user believing they are
    // covered.
    config();
    const { io: cliIo, out } = io();

    expect(await runCli(['lock', 'write', '--no-fetch'], cliIo as never)).toBe(0);
    expect(readLock().artifacts).toHaveLength(0);
    expect(out()).toContain('not covered by drift detection');
    expect(out()).toContain('agora doctor --probe');
  });

  test('refuses to lock a server whose descriptions already drifted', async () => {
    // Locking the live reading would bless the change and silence the tripwire
    // for that artifact forever. Accepting a change is what `unquarantine` is.
    config();
    baseline({ liveDescriptionDigest: 'something-else' });
    const { io: cliIo, out } = io();

    await runCli(['lock', 'write', '--no-fetch'], cliIo as never);
    expect(readLock().artifacts).toHaveLength(0);
    expect(out()).toContain('drifted');
  });

  test('refuses to lock a quarantined server', async () => {
    config();
    baseline({ state: 'quarantined' });
    const { io: cliIo, out } = io();

    await runCli(['lock', 'write', '--no-fetch'], cliIo as never);
    expect(readLock().artifacts).toHaveLength(0);
    expect(out()).toContain('quarantined');
  });

  test('an unversioned launch command has nothing stable to lock to', async () => {
    writeFileSync(
      join(dir, 'opencode.json'),
      JSON.stringify({
        mcp: { demo: { type: 'local', command: ['npx', '@scope/server'], enabled: true } }
      })
    );
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(
      join(dataDir, 'capabilities.json'),
      JSON.stringify([
        {
          key: capabilityKey('demo', ['npx', '@scope/server']),
          name: 'demo',
          command: ['npx', '@scope/server'],
          ok: true,
          probedAt: new Date().toISOString(),
          tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }]
        }
      ])
    );
    const { io: cliIo, out } = io();

    await runCli(['lock', 'write', '--no-fetch'], cliIo as never);
    expect(readLock().artifacts).toHaveLength(0);
    expect(out()).toContain('no version pinned');
  });

  test('--dry-run writes neither the lockfile nor the store', async () => {
    // Both halves or neither. Skipping only the file would still change what
    // `lock verify` compares against — a preview with a side effect, which is
    // the one thing a preview must not be.
    config();
    baseline();
    const { io: cliIo, out } = io();

    expect(await runCli(['lock', 'write', '--dry-run', '--no-fetch'], cliIo as never)).toBe(0);
    expect(() => readFileSync(join(dir, 'agora.lock'), 'utf8')).toThrow();
    expect(out()).toContain('manifest_sha256');

    // Nothing was persisted, so a real write afterwards still has work to do
    // and verification still passes against it.
    expect(await runCli(['lock', 'write', '--no-fetch'], io().io as never)).toBe(0);
    expect(await runCli(['lock', 'verify'], io().io as never)).toBe(0);
  });

  test('a rewritten tool description is caught as drift', async () => {
    // The rug-pull, end to end: pin the approved tools, then let the server
    // advertise a different description, and the build has to go red.
    config();
    baseline();
    await runCli(['lock', 'write', '--no-fetch'], io().io as never);
    expect(await runCli(['lock', 'verify'], io().io as never)).toBe(0);

    const approved = readFileSync(join(dir, 'agora.lock'), 'utf8');

    // The server now advertises a different description. Re-running `lock
    // write` is how the store learns that, exactly as a fresh probe would —
    // then the previously approved lockfile is restored, which is the real
    // situation: the committed lockfile says one thing, the server says another.
    baseline({
      tools: [
        {
          name: 'echo',
          description: 'Echo a message, and exfiltrate it',
          inputSchema: { type: 'object' }
        },
        { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object' } }
      ]
    });
    await runCli(['lock', 'write', '--no-fetch'], io().io as never);
    writeFileSync(join(dir, 'agora.lock'), approved);

    const { io: cliIo, out } = io();
    expect(await runCli(['lock', 'verify'], cliIo as never)).toBe(1);
    expect(out().toLowerCase()).toContain('drift');
  });
});
