import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { parseArgs } from '../src/cli/flags';
import type { FetchLike } from '../src/live';
import { readManifest } from '../src/stack/manifest';

function createIo(
  cwd = process.cwd(),
  options: {
    env?: Record<string, string | undefined>;
    fetcher?: FetchLike;
  } = {}
) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: options.env || {},
      cwd,
      fetcher: options.fetcher
    },
    stdout,
    stderr
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
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

  test('trending --table renders table format', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['trending', '--table', '--limit', '3'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('┌');
    expect(out).toContain('┐');
    expect(out).toContain('id');
    expect(out).toContain('stars');
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
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--write', '--config', configPath], io);
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
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(
        ['install', 'mcp-filesystem', '--write', '--config', configPath],
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
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(
        ['install', 'mcp-filesystem', '--write', '--yes', '--config', configPath],
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
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['install', 'mcp-github', '--write', '--config', configPath], io);

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
        ['install', 'mcp-github', '--write', '--skip-scan', '--config', configPath],
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
        ['install', 'mcp-github', '--write', '--skip-scan', '--save', '--config', configPath],
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
        ['install', 'mcp-github', '--write', '--skip-scan', '--save', '--config', configPath],
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
    const setup = createIo(temp);

    try {
      await runCli(
        ['install', 'mcp-filesystem', '--write', '--yes', '--config', configPath],
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

  test('save stores items in the Agora data directory', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['save', 'wf-security-audit', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Saved wf-security-audit');
      expect(state.savedItems[0].id).toBe('wf-security-audit');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('saved lists persisted items as JSON', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['saved', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.count).toBe(1);
      expect(payload.items[0].item.id).toBe('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('save is idempotent', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['save', 'mcp-github', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('already saved');
      expect(state.savedItems).toHaveLength(1);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('remove deletes saved items', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['remove', 'mcp-github', '--data-dir', dataDir], io);
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Removed mcp-github');
      expect(state.savedItems).toHaveLength(0);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('saved does not create state when empty', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['saved', '--data-dir', dataDir], io);

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('No saved items yet');
      expect(existsSync(join(dataDir, 'state.json'))).toBe(false);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('auth login stores API credentials without echoing the token', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const token = 'ghp_1234567890abcdef';
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(
        [
          'auth',
          'login',
          '--token',
          token,
          '--api-url',
          'https://api.example.test',
          '--data-dir',
          dataDir
        ],
        io
      );
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Stored Agora API token');
      expect(stdout.join('')).not.toContain(token);
      expect(state.auth.accessToken).toBe(token);
      expect(state.auth.apiUrl).toBe('https://api.example.test');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('auth status reports masked stored credentials as JSON', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const token = 'ghp_1234567890abcdef';
    const setup = createIo(temp);

    try {
      await runCli(
        [
          'auth',
          'login',
          '--token',
          token,
          '--api-url',
          'https://api.example.test',
          '--data-dir',
          dataDir
        ],
        setup.io
      );

      const { io, stdout } = createIo(temp);
      const code = await runCli(['auth', 'status', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(stdout.join('')).not.toContain(token);
      expect(payload.authenticated).toBe(true);
      expect(payload.accessTokenPreview).toBe('ghp_...cdef');
      expect(payload.apiUrl).toBe('https://api.example.test');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('auth logout clears stored credentials', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(
        [
          'auth',
          'login',
          '--token',
          'stored-token',
          '--api-url',
          'https://api.example.test',
          '--data-dir',
          dataDir
        ],
        setup.io
      );

      const { io, stdout } = createIo(temp);
      const code = await runCli(['auth', 'logout', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));
      const state = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));

      expect(code).toBe(0);
      expect(payload.authenticated).toBe(false);
      expect(state.auth).toBeUndefined();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('search can use the live API source', async () => {
    const fetcher = async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/packages') {
        return jsonResponse({
          packages: [
            {
              id: 'remote-mcp',
              name: '@remote/server',
              description: 'Remote MCP server',
              author: 'remote-dev',
              version: '1.2.3',
              category: 'mcp',
              tags: 'remote,mcp',
              stars: 99,
              installs: 1000,
              npm_package: '@remote/server',
              created_at: '2026-01-01'
            }
          ]
        });
      }
      return jsonResponse({ workflows: [] });
    };
    const { io, stdout, stderr } = createIo(process.cwd(), { fetcher });

    const code = await runCli(
      ['search', 'remote', '--api', '--api-url', 'https://api.example.test'],
      io
    );

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('source: api');
    expect(stdout.join('')).toContain('remote-mcp');
  });

  test('search falls back to offline data when the API fails', async () => {
    const fetcher = async () => {
      throw new Error('network down');
    };
    const { io, stdout, stderr } = createIo(process.cwd(), { fetcher });

    const code = await runCli(
      ['search', 'filesystem', '--api', '--api-url', 'https://api.example.test'],
      io
    );

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('source: offline');
    expect(stdout.join('')).toContain('mcp-filesystem');
    expect(stderr.join('')).toContain('API unavailable');
  });

  test('install can use live API package metadata', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const fetcher = async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/packages/remote-mcp') {
        return jsonResponse({
          package: {
            id: 'remote-mcp',
            name: '@remote/server',
            description: 'Remote MCP server',
            author: 'remote-dev',
            version: '1.2.3',
            category: 'mcp',
            tags: ['remote'],
            stars: 99,
            installs: 1000,
            npm_package: '@remote/server',
            created_at: '2026-01-01'
          }
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    };
    const { io, stdout } = createIo(temp, { fetcher });

    try {
      const code = await runCli(
        [
          'install',
          'remote-mcp',
          '--api',
          '--api-url',
          'https://api.example.test',
          '--config',
          configPath
        ],
        io
      );

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('@remote/server');
      expect(stdout.join('')).toContain('remote-mcp');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('save keeps a snapshot for API-only items', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const fetcher = async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/packages/remote-mcp') {
        return jsonResponse({
          package: {
            id: 'remote-mcp',
            name: '@remote/server',
            description: 'Remote MCP server',
            author: 'remote-dev',
            version: '1.2.3',
            category: 'mcp',
            tags: ['remote'],
            stars: 99,
            installs: 1000,
            npm_package: '@remote/server',
            created_at: '2026-01-01'
          }
        });
      }
      return jsonResponse({ error: 'not found' }, 404);
    };
    const setup = createIo(temp, { fetcher });

    try {
      await runCli(
        [
          'save',
          'remote-mcp',
          '--api',
          '--api-url',
          'https://api.example.test',
          '--data-dir',
          dataDir
        ],
        setup.io
      );

      const { io, stdout } = createIo(temp);
      const code = await runCli(['saved', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.items[0].item.id).toBe('remote-mcp');
      expect(payload.items[0].item.name).toBe('@remote/server');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('agora use without id lists available workflows', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['use'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('agora use');
    expect(out).toContain('wf-tdd-cycle');
    expect(out).toContain('available workflows');
    expect(out).toContain('agora use <id>');
  });

  test('agora tutorial without id lists available tutorials', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['tutorial'], io);
    const out = stdout.join('');

    expect(code).toBe(0);
    expect(out).toContain('agora tutorial');
    expect(out).toContain('tut-mcp-basics');
    expect(out).toContain('available tutorials');
    expect(out).toContain('agora tutorial <id>');
  });

  test('login is an alias for auth login', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(
        ['login', '--token', 'test-token', '--api-url', 'https://api.test', '--data-dir', dataDir],
        io
      );
      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Stored Agora API token');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('whoami returns auth status as JSON', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(
        [
          'login',
          '--token',
          'whoami-token',
          '--api-url',
          'https://api.test',
          '--data-dir',
          dataDir
        ],
        setup.io
      );

      const { io, stdout } = createIo(temp);
      const code = await runCli(['whoami', '--data-dir', dataDir], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.authenticated).toBe(true);
      expect(payload.apiUrl).toBe('https://api.test');
      expect(payload.accessTokenPreview).toBe('whoa...oken');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});

describe('TTY gate — no-command path', () => {
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
    expect(out).toContain('Library');
    expect(out).toContain('Learn');
    expect(out).toContain('search');
    expect(out).toContain('install');
    expect(out).toContain('init');
    expect(out).toContain('tutorials');
    expect(out).toContain('auth');
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

  test('agora share emits a markdown snippet', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['share', 'mcp-github'], io);
    const out = stdout.join('');
    expect(code).toBe(0);
    expect(out).toContain('**');
    expect(out).toContain('Install: `agora install mcp-github`');
  });

  test('agora share --json wraps the snippet', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['share', 'mcp-github', '--json'], io);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout.join(''));
    expect(payload.id).toBe('mcp-github');
    expect(payload.snippet).toContain('Install:');
  });

  test('agora share unknown id exits 2', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['share', 'nope-no-such-thing'], io);
    expect(code).toBe(2);
    expect(stderr.join('')).toContain('Unknown item');
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

  test('author --json returns expected shape', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['author', 'Anthropic, PBC', '--json'], io);
    const payload = JSON.parse(stdout.join(''));

    expect(code).toBe(0);
    expect(payload.author).toBe('Anthropic, PBC');
    expect(payload.count).toBeGreaterThan(0);
    expect(Array.isArray(payload.items)).toBe(true);
    expect(payload.items[0].author.toLowerCase()).toContain('anthropic');
  });

  test('author unknown prints "No items by …"', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['author', 'no-such-author-xyz'], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('No items by no-such-author-xyz');
  });

  test('bookmarks --json on empty data dir returns { marketplace: [], news: [] }', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-bookmarks-'));
    const dataDir = join(temp, 'state');
    const { io, stdout } = createIo(temp);

    try {
      const code = await runCli(['bookmarks', '--data-dir', dataDir, '--json'], io);
      const payload = JSON.parse(stdout.join(''));

      expect(code).toBe(0);
      expect(payload.marketplace).toEqual([]);
      expect(payload.news).toEqual([]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('bookmarks lists saved marketplace items', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-bookmarks-'));
    const dataDir = join(temp, 'state');
    const setup = createIo(temp);

    try {
      await runCli(['save', 'mcp-github', '--data-dir', dataDir], setup.io);

      const { io, stdout } = createIo(temp);
      const code = await runCli(['bookmarks', '--data-dir', dataDir], io);
      const out = stdout.join('');

      expect(code).toBe(0);
      expect(out).toContain('Catalog');
      expect(out).toContain('mcp-github');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
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
