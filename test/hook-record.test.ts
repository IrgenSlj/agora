import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { readEvents } from '../src/log/store';
import { verifySession } from '../src/log/verify';

const CLI = join(__dirname, '..', 'src', 'cli.ts');
let home: string;
let repo: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'agora-record-'));
  repo = join(home, 'repo');
  mkdirSync(repo);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** Runs the real binary as Claude Code would: payload on stdin. */
function hook(sub: 'record' | 'check', payload: unknown) {
  const r = spawnSync('bun', [CLI, 'hook', sub], {
    input: JSON.stringify(payload),
    env: { ...process.env, AGORA_HOME: join(home, 'agora'), HOME: home },
    encoding: 'utf8'
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const base = { session_id: 'sess-1', cwd: '' };

describe('agora hook record', () => {
  test('a session recorded through the hooks verifies and is closed', () => {
    const p = { ...base, cwd: repo };
    expect(hook('record', { ...p, hook_event_name: 'SessionStart', source: 'startup' }).code).toBe(
      0
    );
    hook('record', {
      ...p,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_input: { file_path: join(repo, 'src', 'a.ts') },
      tool_response: { content: 'SECRET' }
    });
    hook('record', {
      ...p,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "SECRET"' },
      tool_response: { stdout: 'SECRET' }
    });
    hook('record', { ...p, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });

    const dataDir = join(home, 'agora');
    expect(verifySession(dataDir, 'sess-1')).toMatchObject({
      ok: true,
      state: 'closed',
      events: 4
    });
    const events = readEvents(dataDir, 'sess-1');
    expect(events.map((e) => `${e.kind} ${e.subject}`)).toEqual([
      'session start:startup',
      'file_read src/a.ts',
      'exec git',
      'session end:prompt_input_exit'
    ]);
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  test('prints nothing on stdout and exits 0, even on garbage', () => {
    for (const input of [
      'not json',
      '{}',
      '{"session_id":"../x","hook_event_name":"PostToolUse"}'
    ]) {
      const r = spawnSync('bun', [CLI, 'hook', 'record'], {
        input,
        env: { ...process.env, AGORA_HOME: join(home, 'agora') },
        encoding: 'utf8'
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
    }
  });

  test('a denial by the check is recorded as denied', () => {
    const agoraHome = join(home, 'agora');
    // A Cursor config that pins a known-malicious version, so the check denies.
    mkdirSync(join(home, '.cursor'));
    writeFileSync(
      join(home, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: { pm: { command: 'npx', args: ['-y', '@postman/postman-mcp-server@2.4.11'] } }
      })
    );
    const r = hook('check', {
      ...base,
      cwd: repo,
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__pm__run',
      tool_input: { query: 'SECRET' }
    });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const [e] = readEvents(agoraHome, 'sess-1');
    expect(e).toMatchObject({ kind: 'tool_call', subject: 'mcp:pm/run', decision: 'denied' });
  });
});

describe('agora hook install', () => {
  function io() {
    const out: string[] = [];
    return {
      out: () => out.join(''),
      io: {
        stdout: { write: (s: string) => void out.push(s) },
        stderr: { write: (s: string) => void out.push(s) },
        env: { PATH: '' },
        cwd: repo
      }
    };
  }
  const settings = () => JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));

  test('registers the check and the recorder, keeping unrelated settings', async () => {
    mkdirSync(join(repo, '.claude'));
    writeFileSync(
      join(repo, '.claude', 'settings.json'),
      JSON.stringify({ model: 'x', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [] }] } })
    );
    const { io: cliIo, out } = io();
    expect(await runCli(['hook', 'install'], cliIo as never)).toBe(0);
    const s = settings();
    expect(s.model).toBe('x');
    expect(Object.keys(s.hooks).sort()).toEqual(
      ['PermissionDenied', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'SessionStart'].sort()
    );
    expect(s.hooks.PostToolUse).toHaveLength(2);
    expect(s.hooks.PreToolUse[0].hooks[0].command).toBe('agora hook check');
    expect(s.hooks.SessionEnd[0].hooks[0].command).toBe('agora hook record');
    // Never an allow-capable hook type, and no permission settings written.
    expect(s.permissions).toBeUndefined();
    expect(out()).toContain('not on PATH');
  });

  test('installing twice changes nothing', async () => {
    await runCli(['hook', 'install'], io().io as never);
    const first = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
    const second = io();
    expect(await runCli(['hook', 'install'], second.io as never)).toBe(0);
    expect(second.out()).toContain('Already installed');
    expect(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8')).toBe(first);
  });

  test('--dry-run writes nothing', async () => {
    await runCli(['hook', 'install', '--dry-run'], io().io as never);
    expect(() => readFileSync(join(repo, '.claude', 'settings.json'))).toThrow();
  });
});
