/**
 * Tests for src/stack/path-resolve.ts
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveOnPath, KNOWN_RUNNERS } from '../../src/stack/path-resolve';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-pathresolve-test-'));
}

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original });
  }
}

describe('resolveOnPath', () => {
  test('finds a binary placed in a temp PATH dir', () => {
    const binDir = makeTmp();
    try {
      const binaryPath = join(binDir, 'fake-mcp-server');
      writeFileSync(binaryPath, '#!/bin/sh\necho ok\n');
      chmodSync(binaryPath, 0o755);

      const result = resolveOnPath('fake-mcp-server', { PATH: binDir });
      expect(result).toBe(binaryPath);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('returns null for a nonexistent command', () => {
    const binDir = makeTmp();
    try {
      const result = resolveOnPath('definitely-does-not-exist-xyz', { PATH: binDir });
      expect(result).toBeNull();
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('returns null when PATH is empty', () => {
    const result = resolveOnPath('node', { PATH: '' });
    expect(result).toBeNull();
  });

  test('finds binary when PATH has multiple dirs', () => {
    const dir1 = makeTmp();
    const dir2 = makeTmp();
    try {
      const binaryPath = join(dir2, 'my-tool');
      writeFileSync(binaryPath, '#!/bin/sh\n');
      chmodSync(binaryPath, 0o755);

      const result = resolveOnPath('my-tool', { PATH: `${dir1}:${dir2}` });
      expect(result).toBe(binaryPath);
    } finally {
      rmSync(dir1, { recursive: true, force: true });
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('absolute path that exists is returned as-is', () => {
    const binDir = makeTmp();
    try {
      const binaryPath = join(binDir, 'abs-tool');
      writeFileSync(binaryPath, '#!/bin/sh\n');
      chmodSync(binaryPath, 0o755);

      const result = resolveOnPath(binaryPath, { PATH: '' });
      expect(result).toBe(binaryPath);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('absolute path that does not exist returns null', () => {
    const result = resolveOnPath('/nonexistent/path/to/tool', { PATH: '' });
    expect(result).toBeNull();
  });

  test('respects Windows PATH casing and PATHEXT', () => {
    const binDir = makeTmp();
    try {
      const binaryPath = join(binDir, 'opencode.cmd');
      writeFileSync(binaryPath, '@echo off\n');

      const result = withPlatform('win32', () =>
        resolveOnPath('opencode', { Path: binDir, PATHEXT: '.EXE;.CMD;.BAT' })
      );

      expect(result).toBe(binaryPath);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});

describe('KNOWN_RUNNERS', () => {
  test('contains expected runners', () => {
    expect(KNOWN_RUNNERS.has('npx')).toBe(true);
    expect(KNOWN_RUNNERS.has('bunx')).toBe(true);
    expect(KNOWN_RUNNERS.has('uvx')).toBe(true);
    expect(KNOWN_RUNNERS.has('node')).toBe(true);
    expect(KNOWN_RUNNERS.has('python')).toBe(true);
    expect(KNOWN_RUNNERS.has('python3')).toBe(true);
    expect(KNOWN_RUNNERS.has('deno')).toBe(true);
    expect(KNOWN_RUNNERS.has('uv')).toBe(true);
  });
});
