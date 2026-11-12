import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import type { AgentEvent } from '../src/events/schema';
import { appendEvent, ensureMeta } from '../src/log/store';
import { evaluate, lintPolicyText, loadPolicySet, readBaseline } from '../src/policy/engine';
import { replay } from '../src/policy/replay';
import { requestFor } from '../src/policy/requests';

const ev = (
  kind: AgentEvent['kind'],
  subject: string
): Pick<AgentEvent, 'host' | 'kind' | 'subject'> => ({
  host: 'claude-code',
  kind,
  subject
});
const POLICY = `
@id("read-src") permit (principal, action == Action::"read", resource) when { resource.path like "src/*" };
@id("git") permit (principal, action == Action::"exec", resource) when { ["git", "bun"].contains(resource.name) };
@id("github") permit (principal, action == Action::"call", resource) when { resource.mcp && resource.server == "github" };
`;

async function decide(policyText: string | undefined, e: ReturnType<typeof ev>, revoked?: boolean) {
  const set = await loadPolicySet(policyText === undefined ? {} : { policyText });
  const req = requestFor(e, { revoked: () => revoked });
  if (!set || !req) throw new Error('setup');
  return evaluate(set, req);
}

describe('agent-action policy', () => {
  test('the baseline and a learned-shape policy validate against the schema', async () => {
    expect(await lintPolicyText(readBaseline())).toMatchObject({ ok: true });
    expect(await lintPolicyText(POLICY)).toMatchObject({ ok: true });
  });

  test('lint catches an unknown attribute and an unguarded optional one', async () => {
    const typo = await lintPolicyText(
      'permit (principal, action == Action::"read", resource) when { resource.pth like "x" };'
    );
    expect(typo.ok).toBe(false);
    const unguarded = await lintPolicyText(
      'forbid (principal, action == Action::"call", resource) when { resource.revoked };'
    );
    expect(unguarded.ok).toBe(false);
  });

  test('with agora.cedar, anything no rule permits is denied', async () => {
    expect((await decide(POLICY, ev('file_read', 'src/a.ts')))?.decision).toBe('allow');
    expect((await decide(POLICY, ev('file_read', 'class:home')))?.decision).toBe('deny');
    expect((await decide(POLICY, ev('file_write', 'src/a.ts')))?.decision).toBe('deny');
    expect((await decide(POLICY, ev('exec', 'git')))?.decision).toBe('allow');
    expect((await decide(POLICY, ev('exec', 'curl')))?.decision).toBe('deny');
    expect((await decide(POLICY, ev('tool_call', 'mcp:github/create_issue')))?.decision).toBe(
      'allow'
    );
    expect((await decide(POLICY, ev('net', 'evil.example:443')))?.decision).toBe('deny');
  });

  test('without agora.cedar, only the baseline forbids', async () => {
    expect((await decide(undefined, ev('file_read', 'class:home')))?.decision).toBe('allow');
    expect((await decide(undefined, ev('tool_call', 'mcp:pm/run'), true))?.decision).toBe('deny');
  });

  test('a revoked server is denied even when the project permits it', async () => {
    const d = await decide(
      'permit (principal, action, resource);',
      ev('tool_call', 'mcp:github/x'),
      true
    );
    expect(d).toMatchObject({ decision: 'deny', reasons: ['baseline-revoked'] });
  });

  test('unknown revocation status is not treated as revoked', async () => {
    expect((await decide(POLICY, ev('tool_call', 'mcp:github/x'), undefined))?.decision).toBe(
      'allow'
    );
  });

  test('replay groups what would have been denied', async () => {
    const set = await loadPolicySet({ policyText: POLICY });
    if (!set) throw new Error('cedar');
    const events = [
      { ...ev('file_read', 'src/a.ts'), decision: 'allowed' },
      { ...ev('exec', 'curl'), decision: 'allowed' },
      { ...ev('exec', 'curl'), decision: 'allowed' },
      { ...ev('exec', 'rm'), decision: 'denied' }
    ] as AgentEvent[];
    const r = await replay(set, [{ id: 's1', events }]);
    expect(r).toMatchObject({ evaluated: 3, denied: 2 });
    expect(r.groups).toEqual([
      { action: 'exec', subject: 'curl', count: 2, sessions: 1, reasons: [] }
    ]);
  });
});

describe('agora policy and agora replay', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-policy-'));
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
    const code = await runCli(args, io as never);
    return { code, out: out.join('') };
  }

  test('policy init writes a valid placeholder; check exits 0, and 1 on a bad file', async () => {
    expect((await cli(['policy', 'init'])).code).toBe(0);
    expect((await cli(['policy', 'check'])).code).toBe(0);
    writeFileSync(
      join(repo, 'agora.cedar'),
      'permit (principal, action, resource) when { resource.nope };'
    );
    expect((await cli(['policy', 'check'])).code).toBe(1);
  });

  test('replay exits 0 when nothing would be denied and 1 when something would', async () => {
    const dataDir = join(root, 'agora');
    ensureMeta(dataDir, 's1', repo);
    appendEvent(dataDir, 's1', {
      host: 'claude-code',
      kind: 'exec',
      subject: 'git',
      decision: 'allowed'
    });
    appendEvent(dataDir, 's1', {
      host: 'claude-code',
      kind: 'exec',
      subject: 'curl',
      decision: 'allowed'
    });
    writeFileSync(join(repo, 'agora.cedar'), POLICY);
    const r = await cli(['replay']);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/exec curl ·+ 1× · 1 session/);
    writeFileSync(join(repo, 'loose.cedar'), 'permit (principal, action, resource);');
    expect((await cli(['replay', '--policy', 'loose.cedar'])).code).toBe(0);
  });

  test('replay without a policy is a usage error', async () => {
    expect((await cli(['replay'])).code).toBe(2);
  });
});
