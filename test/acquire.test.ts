import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquire } from '../src/acquire';
import { runCli } from '../src/cli/app';
import type { FetchLike } from '../src/live';
import type { MarketplaceItem } from '../src/marketplace';
import type { ScanResult } from '../src/scan';
import { readManifest } from '../src/stack/manifest';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agora-acquire-'));
}

function scanResult(item: MarketplaceItem, warn = 0, fail = 0): ScanResult {
  const checks: ScanResult['checks'] = [];
  if (fail > 0) {
    checks.push({
      name: 'blocked',
      label: 'Blocked',
      status: 'fail',
      message: 'simulated failure'
    });
  }
  if (warn > 0) {
    checks.push({
      name: 'warning',
      label: 'Warning',
      status: 'warn',
      message: 'simulated warning'
    });
  }
  if (checks.length === 0) {
    checks.push({
      name: 'clean',
      label: 'Clean',
      status: 'pass',
      message: 'ok'
    });
  }
  return {
    id: item.id,
    itemKind: item.kind,
    checks,
    summary: {
      pass: checks.filter((check) => check.status === 'pass').length,
      warn: checks.filter((check) => check.status === 'warn').length,
      fail: checks.filter((check) => check.status === 'fail').length
    }
  };
}

function createIo(cwd: string, fetcher?: FetchLike) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { HOME: cwd },
      cwd,
      fetcher
    },
    stdout,
    stderr
  };
}

describe('acquire core', () => {
  test('dry-run returns plan and scan without writing config', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    try {
      const result = await acquire({
        query: 'mcp-postgres',
        configPath,
        dryRun: true,
        cwd: dir,
        deps: { scan: async (item) => scanResult(item) }
      });

      expect(result.status).toBe('dry_run');
      expect(result.item?.id).toBe('mcp-postgres');
      expect(result.plan?.commands[0]).toContain('@modelcontextprotocol/server-postgres');
      expect(result.scan?.summary.fail).toBe(0);
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('clean scan writes config while preserving unknown keys', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        theme: 'system',
        plugin: ['existing-plugin'],
        mcp: {
          'mcp-postgres': {
            type: 'local',
            command: ['old'],
            custom: true
          }
        }
      })
    );

    try {
      const result = await acquire({
        query: 'mcp-postgres',
        configPath,
        cwd: dir,
        deps: { scan: async (item) => scanResult(item) }
      });

      expect(result.status).toBe('installed');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(config.theme).toBe('system');
      expect(config.plugin).toEqual(['existing-plugin']);
      expect(config.mcp['mcp-postgres'].custom).toBe(true);
      expect(config.mcp['mcp-postgres'].command).toEqual([
        'npx',
        '@modelcontextprotocol/server-postgres'
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('failed scan blocks writes', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    try {
      const result = await acquire({
        query: 'mcp-postgres',
        configPath,
        cwd: dir,
        deps: { scan: async (item) => scanResult(item, 0, 1) }
      });

      expect(result.status).toBe('blocked');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('warning scan requires explicit acceptance', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    try {
      const blocked = await acquire({
        query: 'mcp-postgres',
        configPath,
        cwd: dir,
        deps: { scan: async (item) => scanResult(item, 1, 0) }
      });

      expect(blocked.status).toBe('needs_confirmation');
      expect(existsSync(configPath)).toBe(false);

      const accepted = await acquire({
        query: 'mcp-postgres',
        configPath,
        cwd: dir,
        acceptWarnings: true,
        deps: { scan: async (item) => scanResult(item, 1, 0) }
      });

      expect(accepted.status).toBe('installed');
      expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp['mcp-postgres']).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('save records acquired server in agora.toml', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    try {
      const result = await acquire({
        query: 'mcp-postgres',
        configPath,
        cwd: dir,
        save: true,
        deps: { scan: async (item) => scanResult(item) }
      });

      expect(result.status).toBe('installed');
      const manifest = readManifest(join(dir, 'agora.toml'));
      expect(manifest?.mcp['mcp-postgres'].command).toEqual([
        'npx',
        '@modelcontextprotocol/server-postgres'
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('acquire CLI', () => {
  test('acquire --dry-run prints plan and writes nothing', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    const fetcher: FetchLike = async () =>
      new Response(JSON.stringify({ version: '1.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    const { io, stdout } = createIo(dir, fetcher);

    try {
      const code = await runCli(
        ['acquire', 'mcp-postgres', '--dry-run', '--config', configPath],
        io
      );

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Acquire dry run');
      expect(stdout.join('')).toContain('Scan');
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('acquire --accept-warnings writes config', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'opencode.json');
    const fetcher: FetchLike = async () =>
      new Response(JSON.stringify({ version: '1.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    const { io, stdout } = createIo(dir, fetcher);

    try {
      const code = await runCli(
        ['acquire', 'mcp-postgres', '--accept-warnings', '--config', configPath],
        io
      );

      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Acquired');
      expect(JSON.parse(readFileSync(configPath, 'utf8')).mcp['mcp-postgres']).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
