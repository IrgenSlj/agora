import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import type { AgentEvent } from '../src/events/schema';
import { appendEvent, ensureMeta } from '../src/log/store';
import { evaluate, lintPolicyText, loadPolicySet } from '../src/policy/engine';
import { applyBlock, BEGIN, learnPolicy } from '../src/policy/learn';
import { replay } from '../src/policy/replay';
import { requestFor } from '../src/policy/requests';

const e = (
  kind: AgentEvent['kind'],
  subject: string,
  decision: AgentEvent['decision'] = 'allowed'
) => ({ host: 'claude-code', kind, subject, decision }) as AgentEvent;

const sessions = [
  {
    id: 's1',
    events: [
      e('file_read', 'src/a.ts'),
      e('file_read', 'src/deep/b.ts'),
      e('file_write', 'src/a.ts'),
      e('file_read', 'package.json'),
      e('file_read', 'class:tmp'),
      e('exec', 'git'),
      e('exec', 'bun'),
      e('net', 'api.github.com:443'),
      e('tool_call', 'mcp:github/create_issue'),
      e('tool_call', 'tool:TodoWrite'),
      e('exec', 'rm', 'denied')
    ]
  },
  { id: 's2', events: [e('file_read', 'src/c.ts'), e('exec', 'git')] }
];

describe('learnPolicy', () => {
  test('the learned policy validates and permits exactly what was observed', async () => {
    const { block } = learnPolicy(sessions);
    const text = applyBlock(undefined, block);
    expect(await lintPolicyText(text)).toMatchObject({ ok: true });

    const set = await loadPolicySet({ policyText: text });
    if (!set) throw new Error('cedar');
    // Zero legitimate denials on the sessions it was learned from (the phase 3 gate's shape).
    const r = await replay(set, sessions);
    expect(r.denied).toBe(0);

    const decide = async (x: AgentEvent) => (await evaluate(set, requestFor(x)!))?.decision;
    expect(await decide(e('file_read', 'src/new/file.ts'))).toBe('allow'); // same top-level dir
    expect(await decide(e('file_write', 'test/x.ts'))).toBe('deny'); // never written there
    expect(await decide(e('file_read', 'class:home'))).toBe('deny');
    expect(await decide(e('exec', 'rm'))).toBe('deny'); // was denied, so not learned
    expect(await decide(e('exec', 'curl'))).toBe('deny');
    expect(await decide(e('tool_call', 'mcp:github/delete_repo'))).toBe('deny');
    expect(await decide(e('net', 'evil.example:443'))).toBe('deny');
  });

  test('flags permissions outside the repository and counts evidence', () => {
    const { block } = learnPolicy(sessions);
    expect(block).toContain('OUTSIDE THE REPOSITORY: any tmp path');
    expect(block).toMatch(/seen 3 times in 2 sessions\n@id\("learn-read-src"\)/);
  });

  test('applying replaces only the learned block and drops the placeholder', () => {
    const mine =
      '// mine\n@id("my-rule")\nforbid (principal, action == Action::"exec", resource) when { resource.name == "rm" };\n';
    const placeholder = '@id("placeholder-permit-all")\npermit (principal, action, resource);\n';
    const first = applyBlock(mine + placeholder, learnPolicy(sessions).block);
    expect(first).toContain('my-rule');
    expect(first).not.toContain('placeholder-permit-all');
    const second = applyBlock(first, learnPolicy([sessions[1]!]).block);
    expect(second.split(BEGIN)).toHaveLength(2);
    expect(second).toContain('my-rule');
    expect(second).not.toContain('learn-mcp-github');
  });
});

describe('agora learn', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-learn-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function cli(args: string[]) {
    const out: string[] = [];
    const io = {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: root, AGORA_HOME: join(root, 'agora'), NO_COLOR: '1' },
      cwd: repo
    };
    return { code: await runCli(args, io as never), out: out.join('') };
  }

  test('shows a diff without writing, writes with --apply, and replay then passes', async () => {
    const dataDir = join(root, 'agora');
    ensureMeta(dataDir, 's1', repo);
    for (const x of sessions[0]!.events) appendEvent(dataDir, 's1', x);
    const dry = await cli(['learn']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain('+ @id("learn-exec")');
    expect(() => readFileSync(join(repo, 'agora.cedar'))).toThrow();

    expect((await cli(['learn', '--apply'])).code).toBe(0);
    expect(readFileSync(join(repo, 'agora.cedar'), 'utf8')).toContain('learn-read-src');
    expect((await cli(['replay'])).code).toBe(0);
    expect((await cli(['learn'])).out).toContain('already matches');
  });

  test('ignores a session whose log does not verify', async () => {
    const dataDir = join(root, 'agora');
    ensureMeta(dataDir, 's1', repo);
    appendEvent(dataDir, 's1', e('exec', 'git'));
    const path = join(dataDir, 'sessions', 's1.jsonl');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"git"', '"sudo"'));
    const r = await cli(['learn']);
    expect(r.out).toContain('does not verify');
    expect(r.out).toContain('No recorded sessions');
  });
});
