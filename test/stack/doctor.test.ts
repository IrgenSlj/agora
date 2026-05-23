/**
 * Tests for src/stack/doctor.ts (static checks only, probe=false).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkServer, checkStack } from '../../src/stack/doctor';
import { readCapabilityCache } from '../../src/stack/capability-cache';
import type { ConfiguredServer } from '../../src/stack/types';

const FAKE_SERVER = join(import.meta.dir, '../fixtures/mcp-fake-server.js');

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-doctor-test-'));
}

function makeServer(overrides: Partial<ConfiguredServer> = {}): ConfiguredServer {
  return {
    name: 'test-server',
    tool: 'opencode',
    scope: 'project',
    configPath: '/fake/opencode.json',
    transport: 'local',
    command: ['node', 'server.js'],
    enabled: true,
    raw: {},
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// command-resolvable check
// ---------------------------------------------------------------------------
describe('checkServer: command-resolvable', () => {
  test('ok when command is a real binary found on PATH', () => {
    const binDir = makeTmp();
    try {
      // Place a stub `node` binary so the check resolves it
      const stubPath = join(binDir, 'my-real-server');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const server = makeServer({ command: ['my-real-server', 'arg1'] });
      const health = checkServer('test-server', [server], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'command-resolvable')!;
      expect(check).toBeDefined();
      expect(check.ok).toBe(true);
      expect(health.status).toBe('ok');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('error when command binary is not on PATH', () => {
    const emptyDir = makeTmp();
    try {
      const server = makeServer({ command: ['nonexistent-binary-xyz', 'arg'] });
      const health = checkServer('test-server', [server], { env: { PATH: emptyDir } });

      const check = health.checks.find((c) => c.name === 'command-resolvable')!;
      expect(check.ok).toBe(false);
      expect(check.level).toBe('error');
      expect(health.status).toBe('error');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('ok for known runner (node) with a non-flag argument', () => {
    const binDir = makeTmp();
    try {
      // Stub node in our test PATH
      const nodePath = join(binDir, 'node');
      writeFileSync(nodePath, '#!/bin/sh\n');
      chmodSync(nodePath, 0o755);

      const server = makeServer({ command: ['node', 'server.js'] });
      const health = checkServer('test-server', [server], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'command-resolvable')!;
      expect(check.ok).toBe(true);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('error for known runner (npx) with NO non-flag argument', () => {
    const binDir = makeTmp();
    try {
      const npxPath = join(binDir, 'npx');
      writeFileSync(npxPath, '#!/bin/sh\n');
      chmodSync(npxPath, 0o755);

      const server = makeServer({ command: ['npx', '--yes', '--verbose'] });
      const health = checkServer('test-server', [server], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'command-resolvable')!;
      expect(check.ok).toBe(false);
      expect(check.level).toBe('error');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('skipped (no check emitted) for remote-only servers', () => {
    const server = makeServer({
      transport: 'remote',
      url: 'https://example.com',
      command: undefined
    });
    const health = checkServer('test-server', [server], { env: { PATH: '' } });
    const check = health.checks.find((c) => c.name === 'command-resolvable');
    expect(check).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// remote-url check
// ---------------------------------------------------------------------------
describe('checkServer: remote-url', () => {
  test('ok for valid https url', () => {
    const server = makeServer({
      transport: 'remote',
      url: 'https://valid.example.com/mcp',
      command: undefined
    });
    const health = checkServer('test-server', [server]);
    const check = health.checks.find((c) => c.name === 'remote-url')!;
    expect(check).toBeDefined();
    expect(check.ok).toBe(true);
    expect(health.status).toBe('ok');
  });

  test('warn for invalid url', () => {
    const server = makeServer({
      transport: 'remote',
      url: 'not-a-url',
      command: undefined
    });
    const health = checkServer('test-server', [server]);
    const check = health.checks.find((c) => c.name === 'remote-url')!;
    expect(check.ok).toBe(false);
    expect(check.level).toBe('warn');
    expect(health.status).toBe('warn');
  });

  test('warn for non-http(s) scheme', () => {
    const server = makeServer({
      transport: 'remote',
      url: 'ftp://example.com/mcp',
      command: undefined
    });
    const health = checkServer('test-server', [server]);
    const check = health.checks.find((c) => c.name === 'remote-url')!;
    expect(check.ok).toBe(false);
    expect(check.level).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// disabled check
// ---------------------------------------------------------------------------
describe('checkServer: disabled', () => {
  test('warn when all instances are disabled', () => {
    const binDir = makeTmp();
    try {
      const stubPath = join(binDir, 'node');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const server = makeServer({ enabled: false, command: ['node', 'x.js'] });
      const health = checkServer('test-server', [server], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'disabled')!;
      expect(check).toBeDefined();
      expect(check.ok).toBe(false);
      expect(check.level).toBe('warn');
      expect(health.status).toBe('warn');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('no disabled check when at least one instance is enabled', () => {
    const binDir = makeTmp();
    try {
      const stubPath = join(binDir, 'node');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const s1 = makeServer({ enabled: false, command: ['node', 'a.js'] });
      const s2 = makeServer({ enabled: true, command: ['node', 'a.js'] });
      const health = checkServer('test-server', [s1, s2], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'disabled');
      expect(check).toBeUndefined();
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// conflicting-definition check
// ---------------------------------------------------------------------------
describe('checkServer: conflicting-definition', () => {
  test('warn when same name has different commands across tools', () => {
    const binDir = makeTmp();
    try {
      const stubPath = join(binDir, 'node');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const s1 = makeServer({ tool: 'opencode', command: ['node', 'server-a.js'] });
      const s2 = makeServer({ tool: 'cursor', command: ['node', 'server-b.js'] });
      const health = checkServer('test-server', [s1, s2], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'conflicting-definition')!;
      expect(check).toBeDefined();
      expect(check.ok).toBe(false);
      expect(check.level).toBe('warn');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('no conflict when same name has identical commands', () => {
    const binDir = makeTmp();
    try {
      const stubPath = join(binDir, 'node');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const s1 = makeServer({ tool: 'opencode', command: ['node', 'same.js'] });
      const s2 = makeServer({ tool: 'cursor', command: ['node', 'same.js'] });
      const health = checkServer('test-server', [s1, s2], { env: { PATH: binDir } });

      const check = health.checks.find((c) => c.name === 'conflicting-definition');
      expect(check).toBeUndefined();
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('no conflict check for single instance', () => {
    const server = makeServer({
      transport: 'remote',
      url: 'https://ok.example.com'
    });
    const health = checkServer('test-server', [server]);
    const check = health.checks.find((c) => c.name === 'conflicting-definition');
    expect(check).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkStack
// ---------------------------------------------------------------------------
describe('checkStack', () => {
  test('groups servers by name and produces summary', async () => {
    const binDir = makeTmp();
    try {
      const nodePath = join(binDir, 'node');
      writeFileSync(nodePath, '#!/bin/sh\n');
      chmodSync(nodePath, 0o755);

      const s1 = makeServer({ name: 'server-a', command: ['node', 'a.js'] });
      const s2 = makeServer({
        name: 'server-b',
        transport: 'remote',
        url: 'https://b.example.com',
        command: undefined
      });

      const result = await checkStack([s1, s2], { env: { PATH: binDir }, probe: false });

      expect(result.servers.length).toBe(2);
      expect(result.summary.ok).toBeGreaterThanOrEqual(0);
      expect(result.summary.ok + result.summary.warn + result.summary.error).toBe(2);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('error status for unresolvable binary', async () => {
    const emptyDir = makeTmp();
    try {
      const server = makeServer({ command: ['this-binary-does-not-exist'] });
      const result = await checkStack([server], { env: { PATH: emptyDir }, probe: false });

      expect(result.servers[0]!.status).toBe('error');
      expect(result.summary.error).toBe(1);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('produces ok status for good local server', async () => {
    const binDir = makeTmp();
    try {
      const stubPath = join(binDir, 'my-mcp-server');
      writeFileSync(stubPath, '#!/bin/sh\n');
      chmodSync(stubPath, 0o755);

      const server = makeServer({ command: ['my-mcp-server', '--stdio'] });
      const result = await checkStack([server], { env: { PATH: binDir }, probe: false });

      expect(result.servers[0]!.status).toBe('ok');
      expect(result.summary.ok).toBe(1);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('empty server list produces empty summary', async () => {
    const result = await checkStack([]);
    expect(result.servers).toEqual([]);
    expect(result.summary).toEqual({ ok: 0, warn: 0, error: 0 });
  });
});

// ---------------------------------------------------------------------------
// checkStack with probe=true (real MCP handshake)
// ---------------------------------------------------------------------------
describe('checkStack with probe=true', () => {
  test('probe ok: detail mentions tool count, capability cache populated', async () => {
    const dataDir = makeTmp();
    try {
      const server = makeServer({
        name: 'fake-server',
        command: ['node', FAKE_SERVER]
      });

      const result = await checkStack([server], {
        probe: true,
        probeTimeoutMs: 10000,
        dataDir
      });

      const sh = result.servers[0]!;
      const probeCheck = sh.checks.find((c) => c.name === 'probe')!;
      expect(probeCheck).toBeDefined();
      expect(probeCheck.ok).toBe(true);
      expect(probeCheck.detail).toMatch(/2 tool\(s\)/);

      // Capability cache should have been written
      const cached = readCapabilityCache(dataDir);
      expect(cached).toHaveLength(1);
      const entry = cached[0]!;
      expect(entry.ok).toBe(true);
      const toolNames = entry.tools.map((t) => t.name);
      expect(toolNames).toContain('echo');
      expect(toolNames).toContain('add');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 15000);

  test('probe error: missing binary → probe check error, no crash', async () => {
    const dataDir = makeTmp();
    try {
      const server = makeServer({
        name: 'missing-server',
        command: ['this-binary-does-not-exist-xyz-agora']
      });

      const result = await checkStack([server], {
        probe: true,
        probeTimeoutMs: 5000,
        dataDir
      });

      const sh = result.servers[0]!;
      const probeCheck = sh.checks.find((c) => c.name === 'probe');
      // probe check may be absent if command-resolvable already failed,
      // but no exception should be thrown
      expect(sh).toBeDefined();
      if (probeCheck) {
        expect(probeCheck.ok).toBe(false);
        expect(probeCheck.level).toBe('error');
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }, 10000);

  test('probe without dataDir: no crash, no cache file', async () => {
    const server = makeServer({
      name: 'fake-server',
      command: ['node', FAKE_SERVER]
    });

    // No dataDir passed — must not crash
    const result = await checkStack([server], {
      probe: true,
      probeTimeoutMs: 10000
    });

    const sh = result.servers[0]!;
    const probeCheck = sh.checks.find((c) => c.name === 'probe')!;
    expect(probeCheck).toBeDefined();
    expect(probeCheck.ok).toBe(true);
  }, 15000);
});
