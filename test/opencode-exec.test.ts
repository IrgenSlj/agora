import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  buildOpencodeRunArgs,
  normalizeOpencodeModel,
  quoteWinArg,
  resolveOpencode
} from '../src/opencode-exec';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'agora-opencode-exec-test-'));
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

describe('opencode executable helpers', () => {
  test('resolveOpencode finds a POSIX binary on PATH', () => {
    const binDir = makeTmp();
    try {
      const binaryPath = join(binDir, 'opencode');
      writeFileSync(binaryPath, '#!/bin/sh\n');

      const result = withPlatform('linux', () => resolveOpencode({ PATH: binDir }));

      expect(result).toBe(binaryPath);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('resolveOpencode finds a Windows cmd shim through PATHEXT', () => {
    const binDir = makeTmp();
    try {
      const binaryPath = join(binDir, 'opencode.cmd');
      writeFileSync(binaryPath, '@echo off\n');

      const result = withPlatform('win32', () =>
        resolveOpencode({ Path: binDir, PATHEXT: '.EXE;.CMD;.BAT' })
      );

      expect(result).toBe(binaryPath);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('normalizeOpencodeModel prefixes bare model names only', () => {
    expect(normalizeOpencodeModel('deepseek-v4-flash-free')).toBe(
      'opencode/deepseek-v4-flash-free'
    );
    expect(normalizeOpencodeModel('anthropic/claude-sonnet-4-20250514')).toBe(
      'anthropic/claude-sonnet-4-20250514'
    );
  });

  test('buildOpencodeRunArgs includes model, session, and prompt', () => {
    expect(
      buildOpencodeRunArgs({
        model: 'deepseek-v4-flash-free',
        prompt: 'hello "there"',
        sessionId: 'ses_123'
      })
    ).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'opencode/deepseek-v4-flash-free',
      '--session',
      'ses_123',
      'hello "there"'
    ]);
  });

  test('buildOpencodeRunArgs supports continue when no explicit session is present', () => {
    expect(
      buildOpencodeRunArgs({
        model: 'anthropic/claude-sonnet-4-20250514',
        prompt: 'resume',
        continueSession: true
      })
    ).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'anthropic/claude-sonnet-4-20250514',
      '--continue',
      'resume'
    ]);
  });

  test('quoteWinArg handles spaces, quotes, and shell metacharacters', () => {
    expect(quoteWinArg('plain')).toBe('plain');
    expect(quoteWinArg('two words')).toBe('"two words"');
    expect(quoteWinArg('say "hi"')).toBe('"say ^"hi^""');
    expect(quoteWinArg('a&b|c')).toBe('"a^&b^|c"');
  });
});
