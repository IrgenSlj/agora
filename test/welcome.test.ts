import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  test('--json returns { signedIn: false, steps } on empty data dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-'));
    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload.signedIn).toBe(false);
      expect(payload.username).toBeUndefined();
      expect(Array.isArray(payload.steps)).toBe(true);
      expect(payload.steps.length).toBe(6);
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
      const out = stdout.join('');
      expect(out).toContain('Welcome to agora');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default render contains all six section titles', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-sections-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome'], io);
      const out = stdout.join('');
      expect(out).toContain('Sign in');
      expect(out).toContain('Browse the marketplace');
      expect(out).toContain('Read the news');
      expect(out).toContain('Join the community');
      expect(out).toContain('Set up shell completions');
      expect(out).toContain('Start an MCP project');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default render contains recommended commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-cmds-'));
    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome'], io);
      const out = stdout.join('');
      expect(out).toContain('agora auth login');
      expect(out).toContain('agora marketplace');
      expect(out).toContain('agora news');
      expect(out).toContain('agora community');
      expect(out).toContain('agora completions');
      expect(out).toContain('agora init --template');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('step 1 flips to signed-in variant when state.json has auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-auth-'));
    mkdirSync(dir, { recursive: true });
    const state = {
      version: 1,
      savedItems: [],
      auth: {
        accessToken: 'tok_test',
        accessExp: Math.floor(Date.now() / 1000) + 3600,
        savedAt: new Date().toISOString()
      }
    };
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state), 'utf8');
    const prefs = { username: 'alice', theme: 'dark', verbosity: 'medium', email: '', bio: '', defaultNewsSource: 'all', defaultNewsCategory: 'all', lastTab: 0 };
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify(prefs), 'utf8');

    const { io, stdout } = createIo(dir);
    try {
      const code = await runCli(['welcome', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(stdout.join(''));
      expect(payload.signedIn).toBe(true);
      expect(payload.username).toBe('alice');
      expect(payload.steps[0].title).toContain('alice');
      expect(payload.steps[0].commands.some((c: string) => c.includes('agora profile'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('default render shows "Signed in as" when authenticated', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agora-welcome-auth-render-'));
    mkdirSync(dir, { recursive: true });
    const state = {
      version: 1,
      savedItems: [],
      auth: {
        accessToken: 'tok_test',
        accessExp: Math.floor(Date.now() / 1000) + 3600,
        savedAt: new Date().toISOString()
      }
    };
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state), 'utf8');
    const prefs = { username: 'bob', theme: 'dark', verbosity: 'medium', email: '', bio: '', defaultNewsSource: 'all', defaultNewsCategory: 'all', lastTab: 0 };
    writeFileSync(join(dir, 'preferences.json'), JSON.stringify(prefs), 'utf8');

    const { io, stdout } = createIo(dir);
    try {
      await runCli(['welcome'], io);
      const out = stdout.join('');
      expect(out).toContain('Signed in as bob');
      expect(out).toContain('agora profile bob');
      expect(out).toContain('agora bookmarks');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
