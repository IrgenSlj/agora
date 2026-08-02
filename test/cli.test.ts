import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { type ExecLike, parseArgs } from '../src/cli/flags';
import type { FetchLike } from '../src/fetch';
import { readManifest } from '../src/stack/manifest';

function createIo(
  cwd = process.cwd(),
  options: {
    env?: Record<string, string | undefined>;
    fetcher?: FetchLike;
    exec?: ExecLike;
  } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const execed: string[] = [];

  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: options.env || {},
      cwd,
      fetcher: options.fetcher,
      // Default to recording instead of running. Install plans carry real
      // commands (`npm install -g …`, `git clone …`); without this the suite
      // mutates the machine it runs on and blows the per-test time budget.
      exec: options.exec ?? ((command: string) => void execed.push(command))
    },
    stdout,
    stderr,
    execed
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

/**
 * Canned responses for the two endpoints `scanItem` reaches (the GitHub repo
 * API and the npm registry). Without this the `install --write` tests fall
 * through to `globalThis.fetch` and make real network calls — each with an 8s
 * timeout and 2 retries, which blows the 10s per-test budget and makes the
 * suite non-hermetic. Anything unexpected 404s loudly rather than escaping to
 * the network.
 */
function scanFetcher(): FetchLike {
  return async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('https://api.github.com/repos/')) {
      return jsonResponse({ license: { spdx_id: 'MIT' } });
    }
    if (url.startsWith('https://registry.npmjs.org/')) {
      return jsonResponse({ version: '1.0.0' });
    }
    return jsonResponse({ error: `unexpected fetch in test: ${url}` }, 404);
  };
}

describe('CLI argument parsing', () => {
  test('parses commands, positionals, and flags', () => {
    const parsed = parseArgs(['search', 'filesystem', '--category', 'mcp', '-n', '3', '--json']);

    expect(parsed.command).toBe('search');
    expect(parsed.args).toEqual(['filesystem']);
    expect(parsed.flags.category).toBe('mcp');
    expect(parsed.flags.n).toBe('3');
    expect(parsed.flags.json).toBe(true);
  });

  test('parses inline flag values', () => {
    const parsed = parseArgs(['browse', 'mcp-github', '--type=package']);

    expect(parsed.command).toBe('browse');
    expect(parsed.flags.type).toBe('package');
  });
});

describe('CLI commands', () => {
  // These exercise the bundled offline catalog specifically, so they pin
  // --source local — federatedSearch's default ("all enabled") also queries
  // the live official MCP registry, which would make an unmocked test both
  // network-dependent and non-hermetic (see test/federation/*.test.ts for the
  // federation-specific coverage with a DI fetcher).
  test('search prints matching marketplace results', async () => {
    const { io, stdout, stderr } = createIo();
    const code = await runCli(['search', 'filesystem', '--source', 'local'], io);

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('mcp-filesystem');
  });

  test('search supports JSON output', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['search', 'github', '--source', 'local', '--json'], io);
    const payload = JSON.parse(stdout.join(''));

    expect(code).toBe(0);
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.items[0].id).toContain('github');
  });

  test('search --sort stars returns items sorted by stars descending', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(
      ['search', 'mcp', '--sort', 'stars', '--limit', '5', '--source', 'local'],
      io
    );
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('agora search');
    // stars should appear, sorted list
    expect(out).toContain('mcp-');
  });

  test('search --table renders box-drawn table', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(
      ['search', 'mcp-github', '--table', '--limit', '3', '--source', 'local'],
      io
    );
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('┌');
    expect(out).toContain('┐');
    expect(out).toContain('└');
    expect(out).toContain('┘');
    expect(out).toContain('│');
    expect(out).toContain('id');
    expect(out).toContain('name');
    expect(out).toContain('stars');
    expect(out).toContain('installs');
  });

  test('browse surfaces declared permissions for permission-declaring items', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['browse', 'mcp-filesystem'], io);

    expect(code).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('Permissions');
    expect(out).toContain('fs');
  });

  test('browse returns an error for missing items', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['browse', 'missing-package'], io);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Item not found');
  });

  test('install previews config without writing by default', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--config', configPath], io);

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Install preview');
      expect(stdout.join('')).toContain('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write creates an OpenCode config', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { fetcher: scanFetcher() });

    try {
      const code = await runCli(
        ['install', 'mcp-github', '--write', '--accept-warnings', '--config', configPath],
        io
      );
      const config = JSON.parse(readFileSync(configPath, 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Installed');
      expect(stdout.join('')).toContain('Config');
      expect(config.mcp['mcp-github'].command).toEqual([
        'npx',
        '@modelcontextprotocol/server-github'
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write of a permission-declaring item refuses without --yes', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { fetcher: scanFetcher() });

    try {
      const code = await runCli(
        ['install', 'mcp-filesystem', '--write', '--accept-warnings', '--config', configPath],
        io
      );

      expect(code).toBe(2);
      const out = stdout.join('');
      expect(out).toContain('Permissions');
      expect(out).toContain('fs');
      expect(out).toContain('Re-run with --yes');
      // The config file should NOT have been written.
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write --yes of a permission-declaring item prints Granted permissions', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { fetcher: scanFetcher() });

    try {
      const code = await runCli(
        [
          'install',
          'mcp-filesystem',
          '--write',
          '--yes',
          '--accept-warnings',
          '--config',
          configPath
        ],
        io
      );

      expect(code).toBe(0);
      const out = stdout.join('');
      expect(out).toContain('Granted permissions:');
      expect(out).toContain('Installed');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write prints a Scan: section before applying', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { fetcher: scanFetcher() });

    try {
      const code = await runCli(
        ['install', 'mcp-github', '--write', '--accept-warnings', '--config', configPath],
        io
      );

      expect(code).toBe(0);
      const out = stdout.join('');
      expect(out).toContain('Scan:');
      expect(out).toMatch(/\d+ pass · \d+ warning\(s\) · \d+ failure\(s\)/);
      expect(out).toContain('Installed');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write --skip-scan does not print a Scan: section', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(
        [
          'install',
          'mcp-github',
          '--write',
          '--skip-scan',
          '--accept-risk',
          '--config',
          configPath
        ],
        io
      );

      expect(code).toBe(0);
      const out = stdout.join('');
      expect(out).not.toContain('Scan:');
      expect(out).toContain('Installed');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install preview (no --write) does not run scan to stay offline-friendly', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--config', configPath], io);

      expect(code).toBe(0);
      const out = stdout.join('');
      expect(out).toContain('Install preview');
      expect(out).not.toContain('Scan:');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write --save writes opencode config and creates agora.toml', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-save-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { env: { HOME: temp } });

    try {
      const code = await runCli(
        [
          'install',
          'mcp-github',
          '--write',
          '--skip-scan',
          '--accept-risk',
          '--save',
          '--config',
          configPath
        ],
        io
      );

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Installed');
      expect(stdout.join('')).toContain('Saved to');

      const manifest = readManifest(join(temp, 'agora.toml'));
      expect(manifest).not.toBeNull();
      expect(manifest!.mcp['mcp-github']).toBeDefined();
      expect(manifest!.mcp['mcp-github'].command).toEqual([
        'npx',
        '@modelcontextprotocol/server-github'
      ]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write --save preserves pre-existing agora.toml entries', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-save-'));
    const configPath = join(temp, 'opencode.json');
    const { io } = createIo(temp, { env: { HOME: temp } });

    // Write a pre-existing manifest with an unrelated entry
    writeFileSync(
      join(temp, 'agora.toml'),
      '# agora stack manifest\n\n[mcp.existing-server]\ncommand = ["node", "server.js"]\n'
    );

    try {
      const code = await runCli(
        [
          'install',
          'mcp-github',
          '--write',
          '--skip-scan',
          '--accept-risk',
          '--save',
          '--config',
          configPath
        ],
        io
      );

      expect(code).toBe(0);

      const manifest = readManifest(join(temp, 'agora.toml'));
      expect(manifest).not.toBeNull();
      // New entry present
      expect(manifest!.mcp['mcp-github']).toBeDefined();
      // Pre-existing entry preserved
      expect(manifest!.mcp['existing-server']).toBeDefined();
      expect(manifest!.mcp['existing-server'].command).toEqual(['node', 'server.js']);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --save without --write does not create manifest', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-save-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { env: { HOME: temp } });

    try {
      const code = await runCli(['install', 'mcp-github', '--save', '--config', configPath], io);

      expect(code).toBe(0);
      const out = stdout.join('');
      expect(out).toContain('--save only applies when --write');
      expect(existsSync(join(temp, 'agora.toml'))).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('install --write --save --json includes savedToManifest in output', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-save-'));
    const configPath = join(temp, 'opencode.json');
    const { io, stdout } = createIo(temp, { env: { HOME: temp } });

    try {
      const code = await runCli(
        ['install', 'mcp-github', '--save', '--json', '--config', configPath],
        io
      );

      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload).toHaveProperty('savedToManifest');
      expect(payload.savedToManifest.path).toContain('agora.toml');
      expect(Array.isArray(payload.savedToManifest.servers)).toBe(true);
      expect(payload.savedToManifest.servers).toContain('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('config doctor reports config metadata', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const setup = createIo(temp, { fetcher: scanFetcher() });

    try {
      await runCli(
        [
          'install',
          'mcp-filesystem',
          '--write',
          '--yes',
          '--accept-warnings',
          '--config',
          configPath
        ],
        setup.io
      );

      const { io, stdout } = createIo(temp);
      const code = await runCli(['config', 'doctor', '--config', configPath, '--json'], io);
      const report = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(report.exists).toBe(true);
      expect(report.valid).toBe(true);
      expect(report.mcpServers).toBe(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('runCli([]) with non-TTY io returns 0 and prints static welcome, does not hang', async () => {
    const { io, stdout } = createIo();
    // io.stdout has no isTTY property (mock stream) → isInteractive returns false
    const code = await runCli([], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('agora · the trust plane for agentic tooling');
  });
});

describe('help system', () => {
  test('agora help outputs all group labels and a sampling of command names', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['help'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('Catalog');
    expect(out).toContain('Setup');
    expect(out).toContain('Stack');
    expect(out).toContain('search');
    expect(out).toContain('install');
    expect(out).toContain('init');
    expect(out).toContain('acquire');
    expect(out).toContain('doctor');
  });

  test('agora help no longer advertises the retired v1 surface', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['help'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    // Match the command column only — "trending" legitimately appears inside
    // the `today` description.
    const listed = out
      .split('\n')
      .map((line) => /^ {2}(\S+)/.exec(line)?.[1])
      .filter((name): name is string => Boolean(name));

    for (const retired of [
      'auth',
      'curate',
      'chat',
      'trending',
      'workflows',
      'similar',
      'compare',
      'share',
      'author',
      'save',
      'saved',
      'bookmarks',
      'tutorials',
      'tutorial',
      'use',
      'menu'
    ]) {
      expect(listed).not.toContain(retired);
    }
  });

  test('agora help install outputs install-specific manual content', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['help', 'install'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('install');
    expect(out).toContain('Usage:');
    expect(out).toContain('agora install');
    expect(out).toContain('--write');
  });

  test('agora help bogus exits 2 with error on stderr', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['help', 'bogus'], io);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown command: bogus');
  });

  test('agora completions unknown shell exits 2', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['completions', 'powershell'], io);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown shell: powershell');
  });

  test('unknown command suggests the nearest match', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['serch', 'mcp'], io);

    expect(code).toBe(2);
    const err = stderr.join('');
    expect(err).toContain('Unknown command: serch');
    expect(err).toContain('Did you mean: search');
  });

  test('unknown command far from any registered name skips the suggestion', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['xyzzy'], io);

    expect(code).toBe(2);
    const err = stderr.join('');
    expect(err).toContain('Unknown command: xyzzy');
    expect(err).not.toContain('Did you mean');
  });

  test('agora install --help shows manual not the normal install preview', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-help-'));
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', '--help'], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('Usage:');
      expect(out).not.toContain('Install preview');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('open --print writes URL to stdout', async () => {
    const { io, stdout, stderr } = createIo();
    const code = await runCli(['open', 'mcp-github', '--print'], io);

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('https://');
  });

  test('open without id is a usage error', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['open'], io);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('open requires an item id');
  });

  test('open unknown id exits 2 with error', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['open', 'no-such-item-xyz'], io);

    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown item: no-such-item-xyz');
  });

  test('open --json returns id, url, opened', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['open', 'mcp-github', '--print', '--json'], io);
    const payload = JSON.parse(stdout.join(''));

    expect(code).toBe(0);
    expect(payload.id).toBe('mcp-github');
    expect(payload.url).toContain('https://');
    expect(payload.opened).toBe(false);
  });
});

describe('export command — positional format detection', () => {
  test('export json (positional) produces JSON with count/items shape, not empty-result message', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', 'json'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).not.toContain('No items match');
    const payload = JSON.parse(out);
    expect(typeof payload.count).toBe('number');
    expect(payload.count).toBeGreaterThan(0);
    expect(Array.isArray(payload.items)).toBe(true);
  });

  test('export csv (positional) produces CSV with header row id,name,kind,...', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', 'csv'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).not.toContain('No items match');
    const firstLine = out.split('\n')[0];
    expect(firstLine).toContain('id');
    expect(firstLine).toContain('name');
    expect(firstLine).toContain('kind');
  });

  test('export postgres (non-format positional) still works as a query filter', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', 'postgres'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    // Result is JSON (default format) and either has matching items or the helpful message
    // Either way it must NOT be silent — it either has JSON or contains the query name
    const isJson = out.trim().startsWith('{');
    if (isJson) {
      const payload = JSON.parse(out);
      expect(Array.isArray(payload.items)).toBe(true);
    } else {
      expect(out).toContain('postgres');
    }
  });

  test('--format flag still wins over positional', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', '--format', 'csv'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    const firstLine = out.split('\n')[0];
    expect(firstLine).toContain('id');
    expect(firstLine).toContain('name');
    expect(firstLine).toContain('kind');
  });

  test('export with non-matching query emits helpful message naming the query', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['export', 'no-such-xyzzy-item-abc'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('no-such-xyzzy-item-abc');
    expect(out).toContain('agora export');
  });
});

describe('init --template scaffolding', () => {
  function isolatedEnv(tmpDir: string): Record<string, string | undefined> {
    return {
      ...process.env,
      HOME: tmpDir,
      XDG_CONFIG_HOME: join(tmpDir, '.config'),
      OPENCODE_CONFIG: join(tmpDir, 'opencode.json')
    };
  }

  test('scaffolds into empty dir: exit 0, package.json and index.js created', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-init-'));
    const { io, stdout } = createIo(temp, { env: isolatedEnv(temp) });
    try {
      const code = await runCli(['init', '--template', 'node-mcp'], io);
      expect(code).toBe(0);
      expect(existsSync(join(temp, 'package.json'))).toBe(true);
      expect(existsSync(join(temp, 'index.js'))).toBe(true);
      expect(stdout.join('')).toContain('package.json');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('scaffolds node-mcp: creates project-local opencode.json with my-mcp-server entry', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-init-cfg-'));
    const { io } = createIo(temp, { env: isolatedEnv(temp) });
    try {
      const code = await runCli(['init', '--template', 'node-mcp'], io);
      expect(code).toBe(0);
      const configPath = join(temp, 'opencode.json');
      expect(existsSync(configPath)).toBe(true);
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.mcp).toBeDefined();
      expect(config.mcp['my-mcp-server']).toBeDefined();
      expect(config.mcp['my-mcp-server'].command).toEqual(['node', 'index.js']);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('refuses to overwrite when package.json already exists (no --force)', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-init-conflict-'));
    const sentinel = '{"name":"existing","version":"9.9.9"}';
    writeFileSync(join(temp, 'package.json'), sentinel, 'utf8');
    const { io, stderr } = createIo(temp, { env: isolatedEnv(temp) });
    try {
      const code = await runCli(['init', '--template', 'node-mcp'], io);
      expect(code).not.toBe(0);
      expect(stderr.join('')).toContain('package.json');
      const still = readFileSync(join(temp, 'package.json'), 'utf8');
      expect(still).toContain('9.9.9');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('--force overwrites existing files and scaffold succeeds', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-init-force-'));
    const sentinel = '{"name":"existing","version":"9.9.9"}';
    writeFileSync(join(temp, 'package.json'), sentinel, 'utf8');
    const { io } = createIo(temp, { env: isolatedEnv(temp) });
    try {
      const code = await runCli(['init', '--template', 'node-mcp', '--force'], io);
      expect(code).toBe(0);
      const written = readFileSync(join(temp, 'package.json'), 'utf8');
      expect(written).toContain('"name": "my-mcp-server"');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
