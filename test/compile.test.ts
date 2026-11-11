import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { compileClaudeCode, translate } from '../src/compile/claude-code';
import { mergeSettings } from '../src/compile/settings';
import { loadCedar } from '../src/policy/engine';

const LEARNED = `
@id("learn-read-src") permit (principal, action == Action::"read", resource) when { resource.path like "src/*" };
@id("learn-write-readme") permit (principal, action == Action::"write", resource) when { resource.path == "README.md" };
@id("learn-read-outside-tmp") permit (principal, action == Action::"read", resource) when { resource.class == "tmp" };
@id("learn-exec") permit (principal, action == Action::"exec", resource) when { ["bun", "git"].contains(resource.name) };
@id("learn-connect") permit (principal, action == Action::"connect", resource) when { ["api.github.com"].contains(resource.host) };
@id("learn-mcp-github") permit (principal, action == Action::"call", resource) when { resource.mcp && resource.server == "github" && ["create_issue"].contains(resource.name) };
@id("learn-tools") permit (principal, action == Action::"call", resource) when { !resource.mcp && ["TodoWrite"].contains(resource.name) };
@id("no-rm") forbid (principal, action == Action::"exec", resource) when { resource.name == "rm" };
@id("odd") permit (principal, action == Action::"read", resource) when { resource.path like "*.md" };
`;

async function ests(text: string) {
  const cedar = await loadCedar();
  if (!cedar) throw new Error('cedar');
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== 'success') throw new Error('parse');
  return Object.fromEntries(
    parts.policies.map((p) => [
      /@id\("([^"]+)"\)/.exec(p)![1]!,
      (cedar.policyToJson(p) as unknown as { json: Record<string, unknown> }).json
    ])
  );
}

describe('Claude Code compiler', () => {
  test('compiles learned permits to the matching native allow rules', async () => {
    const c = compileClaudeCode(await ests(LEARNED));
    expect(c.allow).toEqual(
      [
        'Bash(bun *)',
        'Bash(git *)',
        'Edit(/README.md)',
        'Read(/src/**)',
        'TodoWrite',
        'WebFetch(domain:api.github.com)',
        'mcp__github__create_issue'
      ].sort()
    );
  });

  test('anything without an exact equivalent is enforced by the hook only, never widened', async () => {
    const c = compileClaudeCode(await ests(LEARNED));
    expect(c.hookOnly.map((h) => h.policy).sort()).toEqual([
      'learn-read-outside-tmp',
      'no-rm',
      'odd'
    ]);
    expect(c.allow.join(' ')).not.toContain('tmp');
    expect(c.notEnforced.length).toBeGreaterThan(0);
  });

  test('a permit constraining the principal is not compiled', () => {
    expect(
      translate({
        effect: 'permit',
        principal: { op: '==' },
        action: { op: 'All' },
        resource: { op: 'All' }
      })
    ).toHaveProperty('why');
  });
});

describe('mergeSettings', () => {
  const comp = (allow: string[]) => ({
    allow,
    compiled: [],
    hookOnly: [],
    notEnforced: [],
    hooks: {}
  });

  test('keeps other keys and rules a person wrote, and removes only stale managed rules', () => {
    const doc = {
      model: 'x',
      permissions: { allow: ['Bash(make *)', 'Read(/src/**)'], deny: ['Read(.env)'] }
    };
    const first = mergeSettings(doc, comp(['Read(/src/**)', 'Bash(git *)']), undefined);
    expect(first.doc).toMatchObject({ model: 'x', permissions: { deny: ['Read(.env)'] } });
    expect((first.doc.permissions as { allow: string[] }).allow).toEqual([
      'Bash(make *)',
      'Read(/src/**)',
      'Bash(git *)'
    ]);
    // Read(/src/**) was the person's already, so Agora does not claim it.
    expect(first.managed.allow).toEqual(['Bash(git *)']);

    const second = mergeSettings(first.doc, comp([]), first.managed);
    expect((second.doc.permissions as { allow: string[] }).allow).toEqual([
      'Bash(make *)',
      'Read(/src/**)'
    ]);
    expect(second.change.removed).toEqual(['Bash(git *)']);
  });
});

describe('agora plan, apply and enforcement', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-compile-'));
    repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeFileSync(join(repo, 'agora.cedar'), LEARNED);
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
  const settings = () => JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));

  test('plan writes nothing; apply writes settings and is idempotent', async () => {
    const plan = await cli(['plan']);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain('+ allow Read(/src/**)');
    expect(plan.out).toContain('Enforced by the hook only');
    expect(() => settings()).toThrow();

    expect((await cli(['apply'])).code).toBe(0);
    expect(settings().permissions.allow).toContain('Bash(git *)');
    expect(settings().hooks.PreToolUse[0].matcher).toBe('*');
    expect((await cli(['plan'])).out).toContain('up to date');
  });

  test('a permit removed from agora.cedar leaves settings on the next apply', async () => {
    await cli(['apply']);
    writeFileSync(join(repo, 'agora.cedar'), LEARNED.replace(/@id\("learn-exec"\).*\n/, ''));
    const r = await cli(['apply']);
    expect(r.out).toContain('- allow Bash(git *)');
    expect(settings().permissions.allow).not.toContain('Bash(git *)');
  });

  function check(tool_name: string, tool_input: Record<string, unknown>) {
    const r = spawnSync('bun', [join(__dirname, '..', 'src', 'cli.ts'), 'hook', 'check'], {
      input: JSON.stringify({
        session_id: 's',
        cwd: repo,
        hook_event_name: 'PreToolUse',
        tool_name,
        tool_input
      }),
      env: { ...process.env, HOME: root, AGORA_HOME: join(root, 'agora') },
      encoding: 'utf8'
    });
    expect(r.status).toBe(0);
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : undefined;
  }

  test('the hook denies what agora.cedar does not permit, and says nothing otherwise', () => {
    expect(check('Read', { file_path: join(repo, 'src', 'a.ts') })).toBeUndefined();
    expect(check('Read', { file_path: '/etc/hosts' })?.permissionDecision).toBe('deny');
    const curl = check('Bash', { command: 'curl https://x.dev' });
    expect(curl?.permissionDecision).toBe('deny');
    expect(curl?.permissionDecisionReason).toContain('does not permit exec curl');
    expect(check('Bash', { command: 'rm -rf build' })?.permissionDecisionReason).toContain('no-rm');
    expect(check('Bash', { command: 'git status' })).toBeUndefined();
  });

  test('a policy that does not parse blocks nothing', () => {
    writeFileSync(join(repo, 'agora.cedar'), 'permit (principal, action, resource) when {');
    expect(check('Bash', { command: 'curl https://x.dev' })).toBeUndefined();
  });

  test('without agora.cedar a non-MCP call is not checked at all', () => {
    rmSync(join(repo, 'agora.cedar'));
    expect(check('Bash', { command: 'curl https://x.dev' })).toBeUndefined();
  });
});
