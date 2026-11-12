import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { compileClaudeCode } from '../src/compile/claude-code';
import { lintPolicyText, loadCedar } from '../src/policy/engine';
import { addProfile, listProfiles } from '../src/policy/profiles';

describe('every shipped profile', () => {
  const profiles = listProfiles();
  test('there are profiles, each naming its package', () => {
    expect(profiles.length).toBeGreaterThan(0);
    for (const p of profiles) expect(p.package).toMatch(/^npm:/);
  });

  test.each(profiles.map((p) => [p.name, p]))(
    '%s parses, validates and compiles',
    async (_n, p) => {
      const text = addProfile('', p, 'srv');
      expect(await lintPolicyText(text)).toMatchObject({ ok: true });
      const cedar = await loadCedar();
      const ests: Record<string, Record<string, unknown>> = {};
      const parts = cedar?.policySetTextToParts(text);
      if (parts?.type !== 'success') throw new Error('parse');
      for (const [i, policy] of parts.policies.entries()) {
        const json = cedar?.policyToJson(policy);
        if (json?.type === 'success') ests[`p${i}`] = json.json as never;
      }
      const compiled = compileClaudeCode(ests);
      expect(compiled.hookOnly).toEqual([]);
      expect(compiled.allow.every((r) => r.startsWith('mcp__srv__'))).toBe(true);
    }
  );
});

describe('agora profile', () => {
  let root: string;
  let repo: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-profile-'));
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
      env: { HOME: root, NO_COLOR: '1' },
      cwd: repo
    };
    return { code: await runCli(['profile', ...args], io as never), out: out.join('') };
  }
  const NAME = 'modelcontextprotocol-server-memory';

  test('add writes the profile once, with the server name filled in', async () => {
    writeFileSync(
      join(repo, 'agora.cedar'),
      'permit (principal, action == Action::"read", resource);\n'
    );
    expect((await cli(['add', NAME, '--server', 'mem'])).code).toBe(0);
    expect((await cli(['add', NAME, '--server', 'mem'])).code).toBe(0);
    const text = readFileSync(join(repo, 'agora.cedar'), 'utf8');
    expect(
      text.match(/agora profile modelcontextprotocol-server-memory \(mem\): begin/g)
    ).toHaveLength(1);
    expect(text).toContain('resource.server == "mem"');
    expect(text).not.toContain('{{server}}');
    expect(text).toContain('Action::"read"');
  });

  test('refuses without an agora.cedar, a bad server name or an unknown profile', async () => {
    expect((await cli(['add', NAME, '--server', 'mem'])).code).toBe(2);
    writeFileSync(join(repo, 'agora.cedar'), '');
    expect((await cli(['add', NAME, '--server', 'a"b'])).code).toBe(2);
    expect((await cli(['add', 'nope', '--server', 'mem'])).code).toBe(2);
  });

  test('list --json names every profile', async () => {
    const r = await cli(['list', '--json']);
    expect(JSON.parse(r.out).map((p: { name: string }) => p.name)).toContain(NAME);
  });
});
