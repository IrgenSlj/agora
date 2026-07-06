import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { probeMcpServer } from '../../src/stack/mcp-probe';

const FAKE_SERVER = join(import.meta.dirname, '../fixtures/mcp-fake-server.js');
const STDERR_SERVER = join(import.meta.dirname, '../fixtures/mcp-stderr-server.js');

describe('probeMcpServer', () => {
  test('happy path: ok=true, serverInfo, two tools', async () => {
    const result = await probeMcpServer(['node', FAKE_SERVER], { timeoutMs: 10000 });
    expect(result.ok).toBe(true);
    expect(result.serverInfo).toEqual({ name: 'fake', version: '1.0' });
    expect(result.capabilities).toEqual({});
    expect(result.tools).toBeDefined();
    expect(result.tools!.length).toBe(2);
    const names = result.tools!.map((t) => t.name);
    expect(names).toContain('echo');
    expect(names).toContain('add');
    const echo = result.tools!.find((t) => t.name === 'echo');
    expect(echo?.description).toBe('echoes');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 15000);

  test('server that exits immediately: ok=false, error contains "exited"', async () => {
    // A node one-liner that exits immediately
    const result = await probeMcpServer(['node', '-e', 'process.exit(0)'], { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited/);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  }, 10000);

  test('server that exits with non-zero code: ok=false, exitCode captured', async () => {
    const result = await probeMcpServer(['node', '-e', 'process.exit(42)'], { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited/);
    expect(result.exitCode).toBe(42);
  }, 10000);

  test('server that never responds: timeout → ok=false, error contains "timed out"', async () => {
    // A node process that stays alive but never writes anything
    const result = await probeMcpServer(['node', '-e', 'setInterval(() => {}, 60000)'], {
      timeoutMs: 500
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
    expect(result.durationMs).toBeGreaterThanOrEqual(400);
  }, 5000);

  test('bad command: ok=false with spawn error', async () => {
    const result = await probeMcpServer(
      ['this-binary-definitely-does-not-exist-on-path-xyz-agora'],
      { timeoutMs: 5000 }
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 10000);

  test('server with non-JSON stdout lines: still parses JSON-RPC correctly', async () => {
    // Write a temporary variant of the fake server that emits a debug line before real JSON
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-mcp-probe-'));
    const noisyServer = join(tmpDir, 'noisy-server.js');
    try {
      writeFileSync(
        noisyServer,
        `#!/usr/bin/env node
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }
    if (!msg || typeof msg !== 'object') continue;
    if (msg.method === 'initialize') {
      // Emit a non-JSON debug line first
      process.stdout.write('DEBUG: server starting\\n');
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'noisy', version: '2.0' }, capabilities: {} } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'greet', description: 'greets' }] } }) + '\\n');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`
      );
      chmodSync(noisyServer, 0o755);

      const result = await probeMcpServer(['node', noisyServer], { timeoutMs: 10000 });
      expect(result.ok).toBe(true);
      expect(result.serverInfo?.name).toBe('noisy');
      expect(result.tools).toHaveLength(1);
      expect(result.tools![0]?.name).toBe('greet');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);

  // ── stderr capture ──────────────────────────────────────────────────────────

  test('server that exits with stderr: result.stderr contains the known line', async () => {
    const result = await probeMcpServer(['node', STDERR_SERVER], {
      timeoutMs: 5000,
      env: { MCP_STDERR_MODE: 'exit' }
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited/);
    expect(result.stderr).toBeDefined();
    expect(result.stderr).toContain('AGORA_TEST_STDERR_LINE');
    // error string should include a stderr snippet
    expect(result.error).toMatch(/stderr:/);
    expect(result.error).toContain('AGORA_TEST_STDERR_LINE');
  }, 10000);

  test('server that hangs with stderr: result.stderr captured on timeout', async () => {
    const result = await probeMcpServer(['node', STDERR_SERVER], {
      timeoutMs: 500,
      env: { MCP_STDERR_MODE: 'hang' }
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
    expect(result.stderr).toBeDefined();
    expect(result.stderr).toContain('AGORA_TEST_STDERR_LINE');
    // error string should include a stderr snippet
    expect(result.error).toMatch(/stderr:/);
  }, 5000);

  test('happy path: result.stderr is absent when no stderr output', async () => {
    const result = await probeMcpServer(['node', FAKE_SERVER], { timeoutMs: 10000 });
    expect(result.ok).toBe(true);
    expect(result.stderr).toBeUndefined();
  }, 15000);

  test('buffer cap: stderr beyond 4000 chars keeps tail only', async () => {
    // Inline server that spams stderr then exits
    const spamScript = [
      `process.stderr.write('A'.repeat(3000));`,
      `process.stderr.write('B'.repeat(2000));`,
      `process.exit(1);`
    ].join('\n');
    const result = await probeMcpServer(['node', '-e', spamScript], { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toBeDefined();
    // Captured tail must be at most 4000 chars (trimEnd may trim trailing whitespace)
    expect(result.stderr!.length).toBeLessThanOrEqual(4000);
    // Must end with Bs (the tail)
    expect(result.stderr!.trimEnd()).toMatch(/B+$/);
  }, 10000);

  test('tools/list RPC error after successful initialize: ok=true with empty tools and error field', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agora-mcp-probe-'));
    const errServer = join(tmpDir, 'err-server.js');
    try {
      writeFileSync(
        errServer,
        `#!/usr/bin/env node
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { continue; }
    if (!msg || typeof msg !== 'object') continue;
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'partial', version: '0.1' }, capabilities: {} } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'tools not supported' } }) + '\\n');
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`
      );
      chmodSync(errServer, 0o755);

      const result = await probeMcpServer(['node', errServer], { timeoutMs: 10000 });
      expect(result.ok).toBe(true);
      expect(result.serverInfo?.name).toBe('partial');
      expect(result.tools).toEqual([]);
      expect(result.error).toMatch(/tools not supported/);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 15000);
});
