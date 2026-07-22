import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import type { FetchLike } from '../src/live';
import {
  capabilityKey,
  descriptionDigest,
  writeCapabilityCache
} from '../src/stack/capability-cache';
import type { ConfiguredServer } from '../src/stack/types';
import { buildUpdatePlan, bumpCommand, classifyUpdate, parsePinnedPackage } from '../src/update';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeServer(overrides: Partial<ConfiguredServer> = {}): ConfiguredServer {
  return {
    name: 'test-server',
    tool: 'opencode',
    scope: 'project',
    configPath: '/fake/opencode.json',
    transport: 'local',
    command: ['npx', 'my-pkg@1.0.0'],
    enabled: true,
    raw: {},
    ...overrides
  };
}

function makeFetcher(responses: Record<string, { status: number; body?: unknown }>) {
  return async (input: string | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        const body = response.body ? JSON.stringify(response.body) : '';
        return new Response(body, { status: response.status });
      }
    }
    throw new Error(`No mock for: ${url}`);
  };
}

function makeRegistryBody(version: string) {
  return {
    'dist-tags': { latest: version },
    time: { modified: '2026-01-01T00:00:00Z' }
  };
}

function createIo(
  cwd = process.cwd(),
  options: { fetcher?: FetchLike; env?: Record<string, string | undefined> } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const env = {
    HOME: cwd,
    XDG_CONFIG_HOME: join(cwd, '.config'),
    OPENCODE_CONFIG: join(cwd, 'opencode.json'),
    ...options.env
  };
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env,
      cwd,
      fetcher: options.fetcher
    },
    stdout,
    stderr
  };
}

// ── parsePinnedPackage ───────────────────────────────────────────────────────

describe('parsePinnedPackage', () => {
  test('scoped + version: @scope/pkg@1.2.3 → name @scope/pkg, version 1.2.3', () => {
    const result = parsePinnedPackage(['npx', '@scope/pkg@1.2.3']);
    expect(result).toEqual({ name: '@scope/pkg', version: '1.2.3', tag: null });
  });

  test('scoped no version: @scope/pkg → version null, tag null', () => {
    const result = parsePinnedPackage(['npx', '@scope/pkg']);
    expect(result).toEqual({ name: '@scope/pkg', version: null, tag: null });
  });

  test('plain + version: pkg@2.0.0 → name pkg, version 2.0.0', () => {
    const result = parsePinnedPackage(['npx', 'pkg@2.0.0']);
    expect(result).toEqual({ name: 'pkg', version: '2.0.0', tag: null });
  });

  test('plain no version: pkg → version null, tag null', () => {
    const result = parsePinnedPackage(['npx', 'pkg']);
    expect(result).toEqual({ name: 'pkg', version: null, tag: null });
  });

  test('dist-tag: pkg@latest → tag latest, version null', () => {
    const result = parsePinnedPackage(['npx', 'pkg@latest']);
    expect(result).toEqual({ name: 'pkg', version: null, tag: 'latest' });
  });

  test('dist-tag next: pkg@next → tag next, version null', () => {
    const result = parsePinnedPackage(['npx', 'pkg@next']);
    expect(result).toEqual({ name: 'pkg', version: null, tag: 'next' });
  });

  test('skips executables and flags: [npx, -y, foo@1.0.0] → name foo, version 1.0.0', () => {
    const result = parsePinnedPackage(['npx', '-y', 'foo@1.0.0']);
    expect(result).toEqual({ name: 'foo', version: '1.0.0', tag: null });
  });

  test('skips multiple executables: [bun, node, pkg@3.0.0]', () => {
    const result = parsePinnedPackage(['bun', 'node', 'pkg@3.0.0']);
    expect(result).toEqual({ name: 'pkg', version: '3.0.0', tag: null });
  });

  test('empty command → null', () => {
    expect(parsePinnedPackage([])).toBeNull();
  });

  test('undefined command → null', () => {
    expect(parsePinnedPackage(undefined)).toBeNull();
  });

  test('all tokens are executables/flags → null', () => {
    expect(parsePinnedPackage(['npx', '-y', '--flag'])).toBeNull();
  });

  test('scoped with dist-tag: @scope/pkg@beta → tag beta, version null', () => {
    const result = parsePinnedPackage(['npx', '@scope/pkg@beta']);
    expect(result).toEqual({ name: '@scope/pkg', version: null, tag: 'beta' });
  });
});

// ── classifyUpdate ───────────────────────────────────────────────────────────

describe('classifyUpdate', () => {
  test('remote transport → unknown', () => {
    const server = makeServer({ transport: 'remote', command: undefined });
    expect(classifyUpdate(server, null, '2.0.0')).toBe('unknown');
  });

  test('pin null (remote or unparseable) → unknown', () => {
    const server = makeServer({ transport: 'local' });
    expect(classifyUpdate(server, null, '2.0.0')).toBe('unknown');
  });

  test('pin.version null (unpinned) → tracks-latest', () => {
    const server = makeServer();
    const pin = { name: 'pkg', version: null, tag: null };
    expect(classifyUpdate(server, pin, '2.0.0')).toBe('tracks-latest');
  });

  test('pin.version null (dist-tag) → tracks-latest', () => {
    const server = makeServer();
    const pin = { name: 'pkg', version: null, tag: 'latest' };
    expect(classifyUpdate(server, pin, '2.0.0')).toBe('tracks-latest');
  });

  test('latest null → unknown', () => {
    const server = makeServer();
    const pin = { name: 'pkg', version: '1.0.0', tag: null };
    expect(classifyUpdate(server, pin, null)).toBe('unknown');
  });

  test('version equals latest → up-to-date', () => {
    const server = makeServer();
    const pin = { name: 'pkg', version: '2.0.0', tag: null };
    expect(classifyUpdate(server, pin, '2.0.0')).toBe('up-to-date');
  });

  test('version differs from latest → updatable', () => {
    const server = makeServer();
    const pin = { name: 'pkg', version: '1.0.0', tag: null };
    expect(classifyUpdate(server, pin, '2.0.0')).toBe('updatable');
  });
});

// ── buildUpdatePlan ──────────────────────────────────────────────────────────

describe('buildUpdatePlan', () => {
  test('builds entries for mixed server states', () => {
    const servers: ConfiguredServer[] = [
      makeServer({ name: 'pinned-outdated', command: ['npx', 'my-pkg@1.0.0'] }),
      makeServer({ name: 'pinned-current', command: ['npx', 'other-pkg@2.0.0'] }),
      makeServer({ name: 'unpinned', command: ['npx', 'loose-pkg'] }),
      makeServer({ name: 'remote-srv', transport: 'remote', command: undefined })
    ];

    const latestByPkg = new Map<string, string | null>([
      ['my-pkg', '2.0.0'],
      ['other-pkg', '2.0.0'],
      ['loose-pkg', '3.0.0']
    ]);

    const plan = buildUpdatePlan(servers, latestByPkg);

    expect(plan).toHaveLength(4);
    const [outdated, current, unpinned, remote] = plan;

    expect(outdated).toMatchObject({
      server: 'pinned-outdated',
      status: 'updatable',
      pkg: 'my-pkg',
      current: '1.0.0',
      latest: '2.0.0'
    });
    expect(outdated?.message).toContain('my-pkg');
    expect(outdated?.message).toContain('1.0.0');
    expect(outdated?.message).toContain('2.0.0');

    expect(current).toMatchObject({ server: 'pinned-current', status: 'up-to-date' });
    expect(current?.message).toContain('(latest)');

    expect(unpinned).toMatchObject({ server: 'unpinned', status: 'tracks-latest' });
    expect(unpinned?.message).toContain('tracks latest');

    expect(remote).toMatchObject({ server: 'remote-srv', status: 'unknown' });
    expect(remote?.message).toContain('not an npm package');
  });

  test('unknown status when latest is null for a pinned server', () => {
    const servers: ConfiguredServer[] = [
      makeServer({ name: 'ghost', command: ['npx', 'ghost-pkg@1.0.0'] })
    ];
    const latestByPkg = new Map<string, string | null>([['ghost-pkg', null]]);
    const plan = buildUpdatePlan(servers, latestByPkg);

    expect(plan[0]?.status).toBe('unknown');
    expect(plan[0]?.message).toContain('could not determine version');
  });

  test('unknown status when pkg is not in the map', () => {
    const servers: ConfiguredServer[] = [
      makeServer({ name: 'missing', command: ['npx', 'no-such@1.0.0'] })
    ];
    const latestByPkg = new Map<string, string | null>();
    const plan = buildUpdatePlan(servers, latestByPkg);

    // latest is null because key not present → unknown
    expect(plan[0]?.status).toBe('unknown');
    expect(plan[0]?.latest).toBeNull();
  });
});

// ── command-level tests ──────────────────────────────────────────────────────

describe('agora update command', () => {
  test('empty state → entries: [] in JSON output', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const { io, stdout } = createIo(temp, { fetcher: makeFetcher({}) });
    try {
      const code = await runCli(['update', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.mode).toBe('plan');
      expect(payload.entries).toEqual([]);
      expect(payload.summary.updatable).toBe(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('empty state → muted text output', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const { io, stdout } = createIo(temp, { fetcher: makeFetcher({}) });
    try {
      const code = await runCli(['update'], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('No MCP servers configured');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('pinned server with update available → updatable entry', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    // Write an opencode.json with a pinned local server
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          'my-server': {
            type: 'local',
            command: ['npx', 'my-pkg@1.0.0'],
            enabled: true
          }
        }
      })
    );

    const fetcher = makeFetcher({
      'my-pkg': { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.mode).toBe('plan');
      expect(payload.entries).toHaveLength(1);
      expect(payload.entries[0].server).toBe('my-server');
      expect(payload.entries[0].status).toBe('updatable');
      expect(payload.entries[0].pkg).toBe('my-pkg');
      expect(payload.entries[0].current).toBe('1.0.0');
      expect(payload.entries[0].latest).toBe('2.0.0');
      expect(payload.summary.updatable).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('pinned server already up-to-date', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          'current-server': {
            type: 'local',
            command: ['npx', 'stable-pkg@3.0.0'],
            enabled: true
          }
        }
      })
    );

    const fetcher = makeFetcher({
      'stable-pkg': { status: 200, body: makeRegistryBody('3.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.entries[0].status).toBe('up-to-date');
      expect(payload.summary['up-to-date']).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('unpinned server → tracks-latest', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          'loose-server': {
            type: 'local',
            command: ['npx', 'loose-pkg'],
            enabled: true
          }
        }
      })
    );

    const fetcher = makeFetcher({
      'loose-pkg': { status: 200, body: makeRegistryBody('5.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.entries[0].status).toBe('tracks-latest');
      expect(payload.summary['tracks-latest']).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--tool filter narrows results', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          'oc-server': {
            type: 'local',
            command: ['npx', 'oc-pkg@1.0.0'],
            enabled: true
          }
        }
      })
    );

    const fetcher = makeFetcher({
      'oc-pkg': { status: 200, body: makeRegistryBody('2.0.0') }
    });

    // Filter to cursor (no cursor config in temp) → empty
    const { io: ioEmpty, stdout: stdoutEmpty } = createIo(temp, { fetcher });
    const codeEmpty = await runCli(['update', '--tool', 'cursor', '--json'], ioEmpty);
    const payloadEmpty = JSON.parse(stdoutEmpty.join(''));
    expect(codeEmpty).toBe(0);
    expect(payloadEmpty.entries).toHaveLength(0);

    rmSync(temp, { recursive: true, force: true });
  });

  test('unknown --tool returns exit 2 with error', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['update', '--tool', 'vscode'], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown tool: vscode');
  });

  test('server name filter with no match returns exit 2', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    // No config files → no servers
    const { io, stderr } = createIo(temp, { fetcher: makeFetcher({}) });
    try {
      const code = await runCli(['update', 'nonexistent-server'], io);
      expect(code).toBe(2);
      expect(stderr.join('')).toContain('nonexistent-server');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('dry-run text output shows update hint when updates are available', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          srv: {
            type: 'local',
            command: ['npx', 'some-pkg@1.0.0'],
            enabled: true
          }
        }
      })
    );

    const fetcher = makeFetcher({
      'some-pkg': { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update'], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('updatable');
      expect(out).toContain('agora update --write --yes');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('cached quarantine blocks update before npm lookup or host write', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-drift-'));
    const dataDir = join(temp, 'agora-data');
    const configPath = join(temp, 'opencode.json');
    const command = ['npx', 'my-pkg@1.0.0'];
    const original = JSON.stringify({
      mcp: {
        'my-server': {
          type: 'local',
          command,
          enabled: false
        }
      }
    });
    writeFileSync(configPath, original);

    const baselineTools = [{ name: 'echo', description: 'old description' }];
    const liveTools = [{ name: 'echo', description: 'new description' }];
    writeCapabilityCache(dataDir, [
      {
        key: capabilityKey('my-server', command),
        name: 'my-server',
        command,
        tools: baselineTools,
        ok: true,
        probedAt: new Date().toISOString(),
        descriptionDigest: descriptionDigest(baselineTools),
        liveDescriptionDigest: descriptionDigest(liveTools),
        liveTools,
        driftDetectedAt: new Date().toISOString(),
        state: 'quarantined',
        quarantineReason: 'description-drift',
        quarantinedAt: new Date().toISOString()
      }
    ]);

    let fetched = false;
    const fetcher: FetchLike = async () => {
      fetched = true;
      throw new Error('npm lookup should not run when drift is blocked');
    };

    const { io, stdout } = createIo(temp, { fetcher, env: { AGORA_HOME: dataDir } });
    try {
      const code = await runCli(['update', '--write', '--yes'], io);
      const out = stdout.join('');

      expect(code).toBe(1);
      expect(out).toContain('drift blocked');
      expect(out).toContain('DRIFT');
      expect(fetched).toBe(false);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

// ── bumpCommand ──────────────────────────────────────────────────────────────

describe('bumpCommand', () => {
  test('scoped pinned: @scope/pkg@1.0.0 bumped to 2.0.0', () => {
    const result = bumpCommand(['npx', '@scope/pkg@1.0.0'], '2.0.0');
    expect(result).toEqual(['npx', '@scope/pkg@2.0.0']);
  });

  test('plain pinned with flag: pkg@1.0.0 bumped, flags preserved', () => {
    const result = bumpCommand(['npx', '-y', 'pkg@1.0.0'], '2.0.0');
    expect(result).toEqual(['npx', '-y', 'pkg@2.0.0']);
  });

  test('no package token: returns original array unchanged', () => {
    const cmd = ['npx', '-y', '--flag'];
    const result = bumpCommand(cmd, '2.0.0');
    expect(result).toEqual(['npx', '-y', '--flag']);
    // also same reference if unchanged is acceptable, but content is the point
  });

  test('plain unpinned: adds @version', () => {
    const result = bumpCommand(['npx', 'pkg'], '3.0.0');
    expect(result).toEqual(['npx', 'pkg@3.0.0']);
  });

  test('empty command: returns empty array', () => {
    const result = bumpCommand([], '1.0.0');
    expect(result).toEqual([]);
  });

  test('does not mutate original array', () => {
    const original = ['npx', 'pkg@1.0.0'];
    bumpCommand(original, '2.0.0');
    expect(original).toEqual(['npx', 'pkg@1.0.0']);
  });
});

// ── write path command-level tests ──────────────────────────────────────────

describe('agora update --write', () => {
  test('--write without --yes returns usage error and writes nothing', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-write-gate-'));
    const configPath = join(temp, 'opencode.json');
    const original = JSON.stringify({
      mcp: {
        srv: { type: 'local', command: ['npx', 'pkg@1.0.0'], enabled: true }
      }
    });
    writeFileSync(configPath, original);

    const { io, stderr } = createIo(temp, { fetcher: makeFetcher({}) });
    try {
      const code = await runCli(['update', '--write'], io);
      expect(code).toBe(2);
      expect(stderr.join('')).toContain('Refusing to write');
      // File must be unchanged
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('dry-run (no --write) does NOT modify file on disk', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-dryrun-'));
    const configPath = join(temp, 'opencode.json');
    const original = JSON.stringify({
      mcp: {
        srv: { type: 'local', command: ['npx', 'pkg@1.0.0'], enabled: true }
      }
    });
    writeFileSync(configPath, original);

    const fetcher = makeFetcher({
      pkg: { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update'], io);
      expect(code).toBe(0);
      expect(readFileSync(configPath, 'utf8')).toBe(original);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--write --yes bumps version in config file and preserves other keys', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-write-'));
    const configPath = join(temp, 'opencode.json');
    const original = {
      $schema: 'https://opencode.ai/schema/opencode.json',
      mcp: {
        'my-server': { type: 'local', command: ['npx', 'my-pkg@1.0.0'], enabled: true }
      }
    };
    writeFileSync(configPath, JSON.stringify(original));

    const fetcher = makeFetcher({
      'my-pkg': { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--write', '--yes'], io);
      expect(code).toBe(0);

      const written = JSON.parse(readFileSync(configPath, 'utf8'));

      // (a) command is bumped
      const serverEntry = written.mcp?.['my-server'];
      expect(serverEntry).toBeDefined();
      expect(serverEntry.command).toEqual(['npx', 'my-pkg@2.0.0']);

      // (b) unrelated key preserved
      expect(written.$schema).toBe('https://opencode.ai/schema/opencode.json');

      // (c) exit code 0
      const out = stdout.join('');
      expect(out).toContain('applied');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--write --yes with up-to-date server: no files changed', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-write-nochange-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          srv: { type: 'local', command: ['npx', 'pkg@2.0.0'], enabled: true }
        }
      })
    );

    const fetcher = makeFetcher({
      pkg: { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--write', '--yes'], io);
      expect(code).toBe(0);
      expect(stdout.join('')).toContain('No files changed');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--write --yes --json returns mode:applied shape', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-update-write-json-'));
    const configPath = join(temp, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        mcp: {
          'my-server': { type: 'local', command: ['npx', 'my-pkg@1.0.0'], enabled: true }
        }
      })
    );

    const fetcher = makeFetcher({
      'my-pkg': { status: 200, body: makeRegistryBody('2.0.0') }
    });

    const { io, stdout } = createIo(temp, { fetcher });
    try {
      const code = await runCli(['update', '--write', '--yes', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload.mode).toBe('applied');
      expect(Array.isArray(payload.updated)).toBe(true);
      expect(payload.updated[0].server).toBe('my-server');
      expect(payload.updated[0].from).toBe('1.0.0');
      expect(payload.updated[0].to).toBe('2.0.0');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
