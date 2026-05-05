import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli } from '../src/cli/app';

function createIo(cwd = process.cwd(), options: {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
} = {}) {
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
  test('search prints matching marketplace results', async () => {
    const { io, stdout, stderr } = createIo();
    const code = await runCli(['search', 'filesystem'], io);

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('mcp-filesystem');
  });

  test('search supports JSON output', async () => {
    const { io, stdout } = createIo();
    const code = await runCli(['search', 'github', '--json'], io);
    const payload = JSON.parse(stdout.join(''));

    expect(code).toBe(0);
    expect(payload.count).toBeGreaterThan(0);
    expect(payload.items[0].id).toContain('github');
  });

  test('browse returns an error for missing items', async () => {
    const { io, stderr } = createIo();
    const code = await runCli(['browse', 'missing-package'], io);

    expect(code).toBe(1);
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
      expect(stdout.join('')).toContain('Updated');
      expect(config.mcpServers['mcp-github'].args).toEqual(['@modelcontextprotocol/server-github']);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('config doctor reports config metadata', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const configPath = join(temp, 'opencode.json');
    const setup = createIo(temp);

    try {
      await runCli(['install', 'mcp-filesystem', '--write', '--config', configPath], setup.io);

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

  test('search can use the live API source', async () => {
    const fetcher = async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/packages') {
        return jsonResponse({
          packages: [{
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
          }]
        });
      }
      return jsonResponse({ workflows: [] });
    };
    const { io, stdout, stderr } = createIo(process.cwd(), { fetcher });

    const code = await runCli(['search', 'remote', '--api', '--api-url', 'https://api.example.test'], io);

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

    const code = await runCli(['search', 'filesystem', '--api', '--api-url', 'https://api.example.test'], io);

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
      const code = await runCli([
        'install',
        'remote-mcp',
        '--api',
        '--api-url',
        'https://api.example.test',
        '--config',
        configPath
      ], io);

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
      await runCli([
        'save',
        'remote-mcp',
        '--api',
        '--api-url',
        'https://api.example.test',
        '--data-dir',
        dataDir
      ], setup.io);

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

  test('publish package posts authenticated metadata', async () => {
    const requests: { url: string; body: any; auth: string | null }[] = [];
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body || '{}')),
        auth: new Headers(init?.headers).get('authorization')
      });
      return jsonResponse({
        package: {
          id: 'remote-mcp',
          name: '@remote/server',
          description: 'Remote MCP server',
          author: 'remote-dev',
          version: '1.2.3',
          category: 'mcp',
          tags: ['remote'],
          stars: 0,
          installs: 0,
          npm_package: '@remote/server',
          created_at: '2026-01-01'
        }
      });
    };
    const { io, stdout } = createIo(process.cwd(), { fetcher });

    const code = await runCli([
      'publish',
      'package',
      '--name',
      '@remote/server',
      '--description',
      'Remote MCP server',
      '--npm',
      '@remote/server',
      '--api-url',
      'https://api.example.test',
      '--token',
      'test-token'
    ], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('Published package remote-mcp');
    expect(requests[0].url).toBe('https://api.example.test/api/packages');
    expect(requests[0].auth).toBe('Bearer test-token');
    expect(requests[0].body.npm_package).toBe('@remote/server');
  });

  test('publish workflow reads prompt files', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'agora-cli-'));
    const promptPath = join(temp, 'prompt.md');
    await Bun.write(promptPath, 'Review this code carefully.');

    const requests: { body: any }[] = [];
    const fetcher = async (_input: string | URL, init?: RequestInit) => {
      requests.push({ body: JSON.parse(String(init?.body || '{}')) });
      return jsonResponse({
        workflow: {
          id: 'wf-remote-review',
          name: 'Remote Review',
          description: 'Review workflow',
          author: 'remote-dev',
          prompt: 'Review this code carefully.',
          tags: ['review'],
          stars: 0,
          forks: 0,
          created_at: '2026-01-01'
        }
      });
    };
    const { io, stdout } = createIo(temp, { fetcher });

    try {
      const code = await runCli([
        'publish',
        'workflow',
        '--name',
        'Remote Review',
        '--description',
        'Review workflow',
        '--prompt-file',
        promptPath,
        '--api-url',
        'https://api.example.test',
        '--token',
        'test-token'
      ], io);

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Published workflow wf-remote-review');
      expect(requests[0].body.prompt).toBe('Review this code carefully.');
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  test('review posts authenticated ratings', async () => {
    const requests: { body: any; auth: string | null }[] = [];
    const fetcher = async (_input: string | URL, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body || '{}')),
        auth: new Headers(init?.headers).get('authorization')
      });
      return jsonResponse({
        review: {
          id: 'review-1',
          item_id: 'mcp-github',
          item_type: 'package',
          author: 'tester',
          rating: 5,
          content: 'Works well',
          created_at: '2026-01-01'
        }
      });
    };
    const { io, stdout } = createIo(process.cwd(), { fetcher });

    const code = await runCli([
      'review',
      'mcp-github',
      '--rating',
      '5',
      '--content',
      'Works well',
      '--api-url',
      'https://api.example.test',
      '--token',
      'test-token'
    ], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('Reviewed mcp-github');
    expect(requests[0].auth).toBe('Bearer test-token');
    expect(requests[0].body.rating).toBe(5);
  });

  test('reviews lists live API reviews', async () => {
    const fetcher = async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/api/reviews');
      expect(url.searchParams.get('item_id')).toBe('mcp-github');
      return jsonResponse({
        reviews: [{
          id: 'review-1',
          item_id: 'mcp-github',
          item_type: 'package',
          author: 'tester',
          rating: 5,
          content: 'Works well',
          created_at: '2026-01-01'
        }]
      });
    };
    const { io, stdout } = createIo(process.cwd(), { fetcher });

    const code = await runCli(['reviews', 'mcp-github', '--api-url', 'https://api.example.test'], io);

    expect(code).toBe(0);
    expect(stdout.join('')).toContain('Agora reviews');
    expect(stdout.join('')).toContain('rating 5/5');
  });

  test('publish requires an auth token', async () => {
    const { io, stderr } = createIo();

    const code = await runCli([
      'publish',
      'package',
      '--name',
      '@remote/server',
      '--description',
      'Remote MCP server',
      '--npm',
      '@remote/server',
      '--api-url',
      'https://api.example.test'
    ], io);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('requires --token');
  });

  test('reviews reports API failures without throwing', async () => {
    const fetcher = async () => {
      throw new Error('reviews unavailable');
    };
    const { io, stderr } = createIo(process.cwd(), { fetcher });

    const code = await runCli(['reviews', 'mcp-github', '--api-url', 'https://api.example.test'], io);

    expect(code).toBe(1);
    expect(stderr.join('')).toContain('reviews unavailable');
  });
});
