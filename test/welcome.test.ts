import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';

function createIo(dataDir: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { AGORA_HOME: dataDir },
      cwd: dataDir
    },
    stdout,
    stderr
  };
}

describe('agora welcome', () => {
  test('--json returns a steps array', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(Array.isArray(payload.steps)).toBe(true);
      expect(payload.steps.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json steps have title, commands, and effect fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-fields-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome', '--json'], io);
      const payload = JSON.parse(stdout.join(''));
      for (const step of payload.steps) {
        expect(typeof step.title).toBe('string');
        expect(Array.isArray(step.commands)).toBe(true);
        expect(typeof step.effect).toBe('string');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default render contains "Welcome to agora" headline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-render-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome'], io);
      expect(code).toBe(0);
      expect(stdout.join('')).toContain('Welcome to agora');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the tour walks the trust plane, not the retired v1 catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-sections-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome'], io);
      const out = stdout.join('');
      expect(out).toContain('Audit what you already run');
      expect(out).toContain('Search across every registry at once');
      expect(out).toContain('Acquire through the gate');
      expect(out).toContain('Make your stack reproducible');
      expect(out).toContain('Set up shell completions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default render recommends commands that still exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-cmds-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome'], io);
      const out = stdout.join('');
      expect(out).toContain('agora doctor');
      expect(out).toContain('agora search');
      expect(out).toContain('agora acquire');
      expect(out).toContain('agora freeze');
      expect(out).toContain('agora completions');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the tour never mentions accounts — Agora has none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-noauth-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome', '--json'], io);
      expect(code).toBe(0);
      const raw = stdout.join('');
      for (const gone of ['auth login', 'Sign in', 'signedIn', 'agora bookmarks', 'agora saved']) {
        expect(raw).not.toContain(gone);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('--json steps do not reference a non-existent agora marketplace command', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-nomarket-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome', '--json'], io);
      expect(code).toBe(0);
      const raw = stdout.join('');
      const payload = JSON.parse(raw);
      const allCommands = (payload.steps as { commands: string[] }[])
        .flatMap((s) => s.commands)
        .join('\n');
      expect(allCommands).not.toContain('agora marketplace');
      expect(raw).not.toContain('api.agora.example');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
