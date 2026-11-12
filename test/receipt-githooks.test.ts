import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { appendEvent, ensureMeta } from '../src/log/store';
import { readNote } from '../src/receipt/git';

const CLI = join(__dirname, '..', 'src', 'cli.ts');
let root: string;
let repo: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agora-githooks-'));
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
  return { code: await runCli(['receipt', ...args], io as never), out: out.join('') };
}
const hook = (name: string) => join(repo, '.git', 'hooks', name);

describe('agora receipt install', () => {
  test('creates both hooks, executable, and is idempotent', async () => {
    expect((await cli(['install'])).code).toBe(0);
    for (const h of ['post-commit', 'pre-push']) {
      expect(readFileSync(hook(h), 'utf8')).toContain('# BEGIN agora');
      expect(statSync(hook(h)).mode & 0o111).not.toBe(0);
    }
    const again = JSON.parse((await cli(['install', '--json'])).out);
    expect(again.hooks.map((h: { result: string }) => h.result)).toEqual([
      'unchanged',
      'unchanged'
    ]);
  });

  test("keeps someone else's hook, and uninstall takes only Agora's lines", async () => {
    writeFileSync(hook('post-commit'), '#!/bin/sh\nnpx lint-staged\n', { mode: 0o755 });
    await cli(['install']);
    expect(readFileSync(hook('post-commit'), 'utf8')).toMatch(/lint-staged[\s\S]*BEGIN agora/);
    await cli(['uninstall']);
    expect(readFileSync(hook('post-commit'), 'utf8')).toBe('#!/bin/sh\nnpx lint-staged\n');
    expect(existsSync(hook('pre-push'))).toBe(false);
  });

  test('a hook that is not a shell script is left alone and reported', async () => {
    writeFileSync(hook('pre-push'), '#!/usr/bin/env node\nconsole.log(1)\n', { mode: 0o755 });
    const r = await cli(['install']);
    expect(r.code).toBe(3);
    expect(r.out).toContain('pre-push skipped');
    expect(readFileSync(hook('pre-push'), 'utf8')).not.toContain('agora');
  });

  test('honours core.hooksPath', async () => {
    execFileSync('git', ['config', 'core.hooksPath', '.husky'], { cwd: repo });
    await cli(['install']);
    expect(readFileSync(join(repo, '.husky', 'post-commit'), 'utf8')).toContain('BEGIN agora');
  });

  test('a commit made after agent activity gets its receipt from the hook', async () => {
    await cli(['install']);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'agora'), `#!/bin/sh\nexec bun ${JSON.stringify(CLI)} "$@"\n`, {
      mode: 0o755
    });
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGORA_HOME: join(root, 'agora'),
      HOME: root,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t'
    };
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'first'], { cwd: repo, env });
    ensureMeta(join(root, 'agora'), 's1', repo);
    appendEvent(join(root, 'agora'), 's1', {
      host: 'claude-code',
      kind: 'file_write',
      subject: 'b.txt',
      decision: 'allowed'
    });
    writeFileSync(join(repo, 'b.txt'), 'b');
    execFileSync('git', ['add', 'b.txt'], { cwd: repo, env });
    execFileSync('git', ['commit', '-q', '-m', 'agent work'], { cwd: repo, env });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    expect(readNote(repo, head)).toContain('application/vnd.in-toto+json');
  });
});
