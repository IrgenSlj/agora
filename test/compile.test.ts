import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { compileClaudeCode, translate } from '../src/compile/claude-code';
import { OPENCODE_PLUGIN } from '../src/compile/opencode';
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
    expect(plan.out).toMatch(/\+ allow {2}Read\(\/src\/\*\*\)/);
    expect(plan.out).toContain('ENFORCED BY THE HOOK ONLY');
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
    expect(r.out).toMatch(/- allow {2}Bash\(git \*\)/);
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

describe('OpenCode', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-opencode-compile-'));
    repo = join(root, 'repo');
    mkdirSync(join(repo, '.opencode'), { recursive: true });
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

  test('one policy compiles to both hosts, each listing its gaps', async () => {
    const plan = await cli(['plan']);
    expect(plan.out).toContain('CLAUDE CODE');
    expect(plan.out).toMatch(/OPENCODE +\+1\n +\.opencode\/plugins\/agora\.js/);
    expect(plan.out).toContain('+ plugin agora.js');
    expect(plan.out).toMatch(/\? opencode: /);
    const json = JSON.parse((await cli(['plan', '--json'])).out);
    expect(json.opencode.not_enforced.length).toBeGreaterThan(0);
    expect(existsSync(join(repo, '.opencode/plugins/agora.js'))).toBe(false);

    await cli(['apply']);
    expect(readFileSync(join(repo, '.opencode/plugins/agora.js'), 'utf8')).toBe(OPENCODE_PLUGIN);
    expect((await cli(['plan'])).out).not.toContain('+ plugin');
  });

  test('a repository without OpenCode gets no plugin', async () => {
    rmSync(join(repo, '.opencode'), { recursive: true });
    expect((await cli(['plan'])).out).toContain('OpenCode · not used here');
    await cli(['apply']);
    expect(existsSync(join(repo, '.opencode'))).toBe(false);
  });

  describe('the plugin', () => {
    let bin: string;
    let saved: string | undefined;
    const load = async () => {
      const file = join(root, `plugin-${Math.random()}.mjs`);
      writeFileSync(file, OPENCODE_PLUGIN);
      const mod = await import(file);
      return mod.AgoraPlugin({ directory: repo });
    };
    const fakeAgora = (stdout: string) => {
      bin = join(root, 'bin');
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(bin, 'agora'), `#!/bin/sh\ncat >/dev/null\nprintf '%s' '${stdout}'\n`, {
        mode: 0o755
      });
      process.env.PATH = `${bin}:${saved}`;
    };
    beforeEach(() => {
      saved = process.env.PATH;
    });
    afterEach(() => {
      process.env.PATH = saved;
    });
    const call = { tool: 'bash', sessionID: 'ses_1', callID: 'c1' };

    test('blocks a call the check denies, with its reason', async () => {
      fakeAgora(
        JSON.stringify({
          hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'no curl' }
        })
      );
      const hooks = await load();
      await expect(
        hooks['tool.execute.before'](call, { args: { command: 'curl x' } })
      ).rejects.toThrow('no curl');
    });

    test('lets the call proceed when the check has no opinion', async () => {
      fakeAgora('');
      const hooks = await load();
      await expect(
        hooks['tool.execute.before'](call, { args: { command: 'ls' } })
      ).resolves.toBeUndefined();
    });

    test('offers the decoy tool only when a canary with a tool is planted', async () => {
      fakeAgora('');
      expect(Object.keys((await load()).tool)).toEqual([]);
      mkdirSync(join(repo, '.agora'), { recursive: true });
      writeFileSync(join(repo, '.agora', 'canaries.json'), JSON.stringify({ tool: true }));
      const hooks = await load();
      expect(Object.keys(hooks.tool)).toEqual(['get_deploy_credentials']);
      expect(await hooks.tool.get_deploy_credentials.execute({}, {})).toBe('access denied');
    });

    test('fails open when agora is not installed', async () => {
      process.env.PATH = join(root, 'nowhere');
      const hooks = await load();
      await expect(
        hooks['tool.execute.before'](call, { args: { command: 'ls' } })
      ).resolves.toBeUndefined();
    });
  });
});
