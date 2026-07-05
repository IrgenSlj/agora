/**
 * Tests for `agora plan` / `agora apply` (P3 Terraform-style split) and the
 * `sync --from` scan gate that blocks a poisoned profile before anything is
 * written — the flagship P3 demo (AGORA_BRIEF §7 demo 2).
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../../src/cli/app';

function makeTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createIo(cwd: string, home: string, extraEnv?: Record<string, string | undefined>) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      env: { HOME: home, NO_COLOR: '1', ...extraEnv },
      cwd
    },
    stdout,
    stderr,
    out: () => stdout.join(''),
    err: () => stderr.join('')
  };
}

function writeManifestToml(cwd: string, content: string): void {
  writeFileSync(join(cwd, 'agora.toml'), content);
}

// ── agora plan ────────────────────────────────────────────────────────────────

describe('agora plan', () => {
  test('missing manifest -> usage error, exit 1', async () => {
    const cwd = makeTmp('agora-plan-nomanifest-');
    const home = makeTmp('agora-plan-nomanifest-home-');
    try {
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['plan'], io);
      expect(code).toBe(1);
      expect(err()).toContain('agora.toml');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('pending changes -> exit 2, never writes', async () => {
    const cwd = makeTmp('agora-plan-pending-');
    const home = makeTmp('agora-plan-pending-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const original = JSON.stringify({ mcp: {} });
      writeFileSync(filePath, original);
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['plan', '--tool', 'opencode'], io);
      expect(code).toBe(2);
      expect(out()).toContain('+ pg');
      expect(out()).toContain('Changes pending');
      // plan is pure read-only — file must be untouched
      expect(readFileSync(filePath, 'utf8')).toBe(original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('no changes pending -> exit 0', async () => {
    const cwd = makeTmp('agora-plan-clean-');
    const home = makeTmp('agora-plan-clean-home-');
    try {
      writeFileSync(
        join(cwd, 'opencode.json'),
        JSON.stringify({ mcp: { pg: { type: 'local', command: ['npx', '@mcp/postgres'] } } })
      );
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['plan', '--tool', 'opencode'], io);
      expect(code).toBe(0);
      expect(out()).toContain('No changes');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json emits { mode: plan, tools, instructions } and still signals drift via exit code', async () => {
    const cwd = makeTmp('agora-plan-json-');
    const home = makeTmp('agora-plan-json-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['plan', '--tool', 'opencode', '--json'], io);
      expect(code).toBe(2);
      const payload = JSON.parse(out());
      expect(payload.mode).toBe('plan');
      expect(Array.isArray(payload.tools)).toBe(true);
      expect(Array.isArray(payload.instructions)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('instructions are included in the plan diff', async () => {
    const cwd = makeTmp('agora-plan-instructions-');
    const home = makeTmp('agora-plan-instructions-home-');
    try {
      writeFileSync(join(cwd, 'CLAUDE.md'), '# hello\n');
      writeManifestToml(
        cwd,
        '[instructions.style]\nsource = "inline"\ncontent = "Use 2-space indent."\n'
      );

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['plan', '--tool', 'claude-code'], io);
      expect(code).toBe(2);
      expect(out()).toContain('+ style');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── agora apply ───────────────────────────────────────────────────────────────

describe('agora apply', () => {
  test('applies MCP servers and instructions, exit 0', async () => {
    const cwd = makeTmp('agora-apply-');
    const home = makeTmp('agora-apply-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(
        cwd,
        '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n\n' +
          '[instructions.style]\nsource = "inline"\ncontent = "Be terse."\n'
      );

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['apply', '--tool', 'opencode'], io);
      expect(code).toBe(0);
      expect(out()).toContain('agora apply');

      const config = JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf8'));
      expect(config.mcp['pg']).toBeDefined();
      expect(config.instructions).toContain('.agora/instructions/style.md');
      expect(existsSync(join(cwd, '.agora', 'instructions', 'style.md'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json emits { mode: applied, tools, instructions }', async () => {
    const cwd = makeTmp('agora-apply-json-');
    const home = makeTmp('agora-apply-json-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "@mcp/postgres"]\n');

      const { io, out } = createIo(cwd, home);
      const code = await runCli(['apply', '--tool', 'opencode', '--json'], io);
      expect(code).toBe(0);
      const payload = JSON.parse(out());
      expect(payload.mode).toBe('applied');
      expect(Array.isArray(payload.tools)).toBe(true);
      expect(Array.isArray(payload.instructions)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('invalid --tool returns exit 1, nothing written', async () => {
    const cwd = makeTmp('agora-apply-badtool-');
    const home = makeTmp('agora-apply-badtool-home-');
    try {
      writeManifestToml(cwd, '[mcp.pg]\ncommand = ["npx", "pg"]\n');
      const { io, err } = createIo(cwd, home);
      const code = await runCli(['apply', '--tool', 'nonexistent-tool'], io);
      expect(code).toBe(1);
      expect(err()).toContain('Unknown tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ── sync --from: the scan gate blocks a poisoned profile ──────────────────────

describe('agora sync --from: scan gate blocks a poisoned entry', () => {
  test('an mcp entry pointing at a nonexistent npm package fails npm_exists -> exit 3, nothing written', async () => {
    const cwd = makeTmp('agora-gate-poisoned-');
    const home = makeTmp('agora-gate-poisoned-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const original = JSON.stringify({ mcp: {} });
      writeFileSync(filePath, original);

      const poisonedToml =
        '[mcp.evil-server]\ncommand = ["npx", "-y", "@totally-fake-org/does-not-exist"]\n';
      const sharedPath = join(cwd, 'poisoned.toml');
      writeFileSync(sharedPath, poisonedToml);

      // Hermetic DI fetcher: simulate the npm registry saying the package
      // does not exist (a typosquat/removed-package scenario), the same way
      // a real supply-chain attack would 404 on a yanked or fake package.
      const fakeFetcher = async (url: string) => {
        if (url.includes('registry.npmjs.org')) {
          return { ok: false, status: 404, text: async () => '' } as Response;
        }
        return { ok: true, status: 200, text: async () => '' } as Response;
      };

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', sharedPath, '--tool', 'opencode', '--write', '--yes'],
        io
      );

      expect(code).toBe(3);
      expect(out()).toContain('gate blocked');
      expect(out()).toContain('evil-server');

      // Nothing written — opencode.json untouched.
      expect(readFileSync(filePath, 'utf8')).toBe(original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('--json gate-blocked output has { mode: "gate-blocked", blocked }', async () => {
    const cwd = makeTmp('agora-gate-json-');
    const home = makeTmp('agora-gate-json-home-');
    try {
      writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({ mcp: {} }));
      const poisonedToml = '[mcp.evil]\ncommand = ["npx", "@fake/nonexistent-pkg-xyz"]\n';
      const sharedPath = join(cwd, 'poisoned.toml');
      writeFileSync(sharedPath, poisonedToml);

      const fakeFetcher = async (_url: string) =>
        ({ ok: false, status: 404, text: async () => '' }) as Response;

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(['sync', '--from', sharedPath, '--tool', 'opencode', '--json'], io);
      expect(code).toBe(3);
      const payload = JSON.parse(out());
      expect(payload.mode).toBe('gate-blocked');
      expect(Array.isArray(payload.blocked)).toBe(true);
      expect(payload.blocked.length).toBeGreaterThan(0);
      expect(payload.blocked[0].name).toBe('evil');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('a clean profile (no fail checks) passes the gate and proceeds to write', async () => {
    const cwd = makeTmp('agora-gate-clean-');
    const home = makeTmp('agora-gate-clean-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      writeFileSync(filePath, JSON.stringify({ mcp: {} }));

      const cleanToml =
        '[mcp.good-server]\ncommand = ["npx", "-y", "@modelcontextprotocol/server-fetch"]\n';
      const sharedPath = join(cwd, 'clean.toml');
      writeFileSync(sharedPath, cleanToml);

      // Package "exists" per our fake registry.
      const fakeFetcher = async (_url: string) =>
        ({
          ok: true,
          status: 200,
          text: async () => '{}',
          json: async () => ({ version: '1.0.0' })
        }) as Response;

      const { io } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(
        ['sync', '--from', sharedPath, '--tool', 'opencode', '--write', '--yes'],
        io
      );
      expect(code).toBe(0);

      const result = JSON.parse(readFileSync(filePath, 'utf8'));
      expect(result.mcp['good-server']).toBeDefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('plan --from also runs the gate and blocks before computing any diff', async () => {
    const cwd = makeTmp('agora-plan-gate-');
    const home = makeTmp('agora-plan-gate-home-');
    try {
      const poisonedToml = '[mcp.evil]\ncommand = ["npx", "@fake/nonexistent-pkg-abc"]\n';
      const sharedPath = join(cwd, 'poisoned.toml');
      writeFileSync(sharedPath, poisonedToml);

      const fakeFetcher = async (_url: string) =>
        ({ ok: false, status: 404, text: async () => '' }) as Response;

      const { io, out } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(['plan', '--from', sharedPath, '--tool', 'opencode'], io);
      expect(code).toBe(3);
      expect(out()).toContain('gate blocked');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('apply --from also runs the gate and refuses to write on failure', async () => {
    const cwd = makeTmp('agora-apply-gate-');
    const home = makeTmp('agora-apply-gate-home-');
    try {
      const filePath = join(cwd, 'opencode.json');
      const original = JSON.stringify({ mcp: {} });
      writeFileSync(filePath, original);

      const poisonedToml = '[mcp.evil]\ncommand = ["npx", "@fake/nonexistent-pkg-def"]\n';
      const sharedPath = join(cwd, 'poisoned.toml');
      writeFileSync(sharedPath, poisonedToml);

      const fakeFetcher = async (_url: string) =>
        ({ ok: false, status: 404, text: async () => '' }) as Response;

      const { io } = createIo(cwd, home);
      (io as any).fetcher = fakeFetcher;

      const code = await runCli(['apply', '--from', sharedPath, '--tool', 'opencode'], io);
      expect(code).toBe(3);
      expect(readFileSync(filePath, 'utf8')).toBe(original);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
