import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { normaliseOpenCode } from '../src/events/opencode';
import { readEvents } from '../src/log/store';
import { verifySession } from '../src/log/verify';

const CLI = join(__dirname, '..', 'src', 'cli.ts');
const repo = '/work/repo';
const call = (tool_name: string, tool_input: Record<string, unknown>) =>
  normaliseOpenCode({ tool_name, tool_input, cwd: repo });

describe('normaliseOpenCode', () => {
  test('maps OpenCode tools to the same kinds as Claude Code', () => {
    expect(call('read', { filePath: `${repo}/src/a.ts` })[0]).toMatchObject({
      host: 'opencode',
      kind: 'file_read',
      subject: 'src/a.ts'
    });
    expect(call('edit', { filePath: `${repo}/b.ts` })[0]).toMatchObject({
      kind: 'file_write',
      subject: 'b.ts'
    });
    expect(call('bash', { command: 'git status' })[0]).toMatchObject({
      kind: 'exec',
      subject: 'git'
    });
    expect(call('webfetch', { url: 'https://example.com/x?y=1' })[0]).toMatchObject({
      kind: 'net',
      subject: 'example.com:443'
    });
    expect(call('grep', { pattern: 'x' })[0]).toMatchObject({ kind: 'file_read', subject: '.' });
    expect(call('github_create_issue', {})[0]).toMatchObject({
      kind: 'tool_call',
      subject: 'tool:github_create_issue'
    });
  });

  test('never carries arguments or contents', () => {
    const SECRET = 'sk-SECRET-12345';
    const drafts = [
      call('bash', { command: `curl -H "Authorization: ${SECRET}" https://x.dev` }),
      call('write', { filePath: `${repo}/n.md`, content: SECRET }),
      call('edit', { filePath: `${repo}/a.ts`, oldString: SECRET, newString: SECRET }),
      call('grep', { pattern: SECRET }),
      call('glob', { pattern: `**/${SECRET}*` }),
      call('webfetch', { url: `https://api.example.com/v1?key=${SECRET}` }),
      call(`tool ${SECRET}`, {})
    ].flat();
    expect(JSON.stringify(drafts)).not.toContain('SECRET');
  });
});

describe('agora hook with an OpenCode payload', () => {
  let home: string;
  let dir: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'agora-opencode-'));
    dir = join(home, 'repo');
    mkdirSync(dir);
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const hook = (sub: 'record' | 'check', payload: unknown) => {
    const r = spawnSync('bun', [CLI, 'hook', sub], {
      input: JSON.stringify(payload),
      env: { ...process.env, AGORA_HOME: join(home, 'agora'), HOME: home },
      encoding: 'utf8'
    });
    return { code: r.status, stdout: r.stdout };
  };
  const base = () => ({ host: 'opencode', session_id: 'ses_abc123', cwd: dir });

  test('records an OpenCode session as host opencode', () => {
    hook('record', { ...base(), hook_event_name: 'SessionStart', source: 'startup' });
    hook('record', {
      ...base(),
      hook_event_name: 'PostToolUse',
      tool_name: 'bash',
      tool_input: { command: 'ls -la' }
    });
    const dataDir = join(home, 'agora');
    expect(verifySession(dataDir, 'ses_abc123').ok).toBe(true);
    const events = readEvents(dataDir, 'ses_abc123');
    expect(events.map((e) => [e.host, e.kind, e.subject])).toEqual([
      ['opencode', 'session', 'start:startup'],
      ['opencode', 'exec', 'ls']
    ]);
  });

  test('the check denies what agora.cedar does not permit, and records it', () => {
    writeFileSync(
      join(dir, 'agora.cedar'),
      'permit (principal, action == Action::"exec", resource) when { ["ls"].contains(resource.name) };\n'
    );
    expect(
      hook('check', { ...base(), tool_name: 'bash', tool_input: { command: 'ls' } }).stdout
    ).toBe('');
    const denied = hook('check', {
      ...base(),
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      tool_input: { command: 'curl https://x.dev' }
    });
    expect(denied.code).toBe(0);
    const out = JSON.parse(denied.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('exec curl');
    const events = readEvents(join(home, 'agora'), 'ses_abc123');
    expect(events.at(-1)).toMatchObject({ host: 'opencode', subject: 'curl', decision: 'denied' });
  });
});

describe('paths are relative to the repository root', () => {
  test('a session whose shell is in a subdirectory still names files from the root', async () => {
    const { normaliseHook } = await import('../src/events/hook-payload');
    const root = mkdtempSync(join(tmpdir(), 'agora-subdir-'));
    try {
      mkdirSync(join(root, '.git'));
      mkdirSync(join(root, 'docs', 'assets'), { recursive: true });
      const drafts = normaliseHook({
        cwd: join(root, 'docs', 'assets'),
        tool_name: 'Read',
        tool_input: { file_path: join(root, 'docs', 'assets', 'card.png') }
      });
      expect(drafts[0]?.subject).toBe('docs/assets/card.png');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
