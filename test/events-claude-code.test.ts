import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { normaliseClaudeCode } from '../src/events/claude-code';
import { EventSubject } from '../src/events/schema';

const repo = '/work/repo';
const post = (tool_name: string, tool_input: Record<string, unknown>, extra = {}) => ({
  session_id: 'abc',
  cwd: repo,
  hook_event_name: 'PostToolUse',
  tool_name,
  tool_input,
  tool_response: { stdout: 'SECRET-OUTPUT', content: 'SECRET-OUTPUT' },
  ...extra
});

describe('Claude Code normaliser', () => {
  test('never carries arguments, contents, outputs, prompts or URL paths', () => {
    // AGENTS.md rule 6. Every payload below hides the same marker somewhere an
    // event must not reach.
    const SECRET = 'sk-SECRET-12345';
    const payloads = [
      post('Bash', {
        command: `curl -H "Authorization: ${SECRET}" https://x.dev`,
        description: SECRET
      }),
      post('Bash', { command: `export TOKEN=${SECRET} && git push` }),
      post('Write', { file_path: `${repo}/notes.md`, content: SECRET }),
      post('Edit', { file_path: `${repo}/a.ts`, old_string: SECRET, new_string: SECRET }),
      post('Read', { file_path: `${repo}/a.ts`, offset: 1 }),
      post('Grep', { pattern: SECRET, path: `${repo}/src` }),
      post('Glob', { pattern: `**/${SECRET}*` }),
      post('WebFetch', { url: `https://api.example.com/v1?key=${SECRET}`, prompt: SECRET }),
      post('WebSearch', { query: SECRET }),
      post('mcp__github__create_issue', { title: SECRET, body: SECRET }),
      post('Agent', { prompt: SECRET, description: SECRET }),
      post('Read', { file_path: `/home/someone/${SECRET}.txt` })
    ];
    for (const p of payloads) {
      const events = normaliseClaudeCode(p);
      expect(JSON.stringify(events), `${p.tool_name} leaked`).not.toContain('SECRET');
      for (const e of events) expect(EventSubject.safeParse(e.subject).success).toBe(true);
    }
  });

  test('maps built-in tools to kinds and subjects', () => {
    const one = (p: ReturnType<typeof post>) => normaliseClaudeCode(p)[0];
    expect(one(post('Read', { file_path: `${repo}/src/a.ts` }))).toMatchObject({
      kind: 'file_read',
      subject: 'src/a.ts',
      decision: 'allowed'
    });
    expect(one(post('Edit', { file_path: `${repo}/src/a.ts` }))).toMatchObject({
      kind: 'file_write',
      subject: 'src/a.ts'
    });
    expect(
      one(post('Bash', { command: 'FOO=1 sudo /usr/bin/git push origin main' }))
    ).toMatchObject({
      kind: 'exec',
      subject: 'git'
    });
    expect(one(post('WebFetch', { url: 'https://api.github.com/repos/x' }))).toMatchObject({
      kind: 'net',
      subject: 'api.github.com:443'
    });
    expect(one(post('mcp__github__create_issue', {}))).toMatchObject({
      kind: 'tool_call',
      subject: 'mcp:github/create_issue'
    });
    expect(one(post('TodoWrite', {}))).toMatchObject({
      kind: 'tool_call',
      subject: 'tool:TodoWrite'
    });
    expect(one(post('Glob', { pattern: '*.ts' }))).toMatchObject({
      kind: 'file_read',
      subject: '.'
    });
  });

  test('paths outside the repository become a class', () => {
    const subject = (file_path: string) =>
      normaliseClaudeCode(post('Read', { file_path }))[0]?.subject;
    expect(subject(join(homedir(), '.ssh', 'id_rsa'))).toBe('class:home');
    expect(subject(join(tmpdir(), 'x'))).toBe('class:tmp');
    expect(subject('/etc/hosts')).toBe('class:system');
    expect(subject(`${repo}/../sibling/file`)).toBe('class:other');
  });

  test('a denial from PreToolUse is recorded as denied', () => {
    const [e] = normaliseClaudeCode(
      { ...post('mcp__bad__x', {}), hook_event_name: 'PreToolUse' },
      'denied'
    );
    expect(e).toMatchObject({ subject: 'mcp:bad/x', decision: 'denied' });
  });

  test('a payload without a tool yields nothing', () => {
    expect(normaliseClaudeCode({ session_id: 'abc', hook_event_name: 'PostToolUse' })).toEqual([]);
  });
});
