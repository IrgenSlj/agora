import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { appendEvent, ensureMeta, logPath } from '../src/log/store';
import { commitAt } from './helpers/git';

let root: string;
let repo: string;
let dataDir: string;
const at = (s: number) => new Date((1_700_000_000 + s) * 1000 + 100);

function cli(args: string[]) {
  const out: string[] = [];
  const io = {
    stdout: { write: (s: string) => void out.push(s) },
    stderr: { write: (s: string) => void out.push(s) },
    env: { AGORA_HOME: dataDir, NO_COLOR: '1', HOME: root },
    cwd: repo
  };
  return runCli(['receipt', ...args], io as never).then((code) => ({ code, out: out.join('') }));
}

const note = (sha: string) =>
  execFileSync('git', ['notes', '--ref=refs/notes/agora', 'show', sha], {
    cwd: repo,
    encoding: 'utf8'
  });
const setNote = (sha: string, body: string) =>
  execFileSync('git', ['notes', '--ref=refs/notes/agora', 'add', '-f', '-m', body, sha], {
    cwd: repo
  });

let sha: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agora-receipt-cli-'));
  repo = join(root, 'repo');
  dataDir = join(root, 'agora');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  commitAt(repo, 1000, 'a.txt');
  ensureMeta(dataDir, 's1', repo);
  appendEvent(
    dataDir,
    's1',
    { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
    at(1500)
  );
  sha = commitAt(repo, 2000, 'b.txt');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('agora receipt', () => {
  test('write stores a receipt in git notes, and verify accepts it', async () => {
    const w = await cli(['write']);
    expect(w.code).toBe(0);
    expect(w.out).toContain('receipt written');
    expect(JSON.parse(note(sha)).payloadType).toBe('application/vnd.in-toto+json');
    const v = await cli(['verify']);
    expect(v.code).toBe(0);
    expect(v.out).toContain('receipt verifies · signer none');
    expect(v.out).toContain('wrote      b.txt');
  });

  test('a commit without agent activity gets no receipt; verify says not established', async () => {
    const plain = commitAt(repo, 3000, 'c.txt');
    expect((await cli(['write', plain])).out).toContain('no receipt written');
    const v = await cli(['verify', plain]);
    expect(v.code).toBe(0);
    expect(v.out).toContain('not established');
    expect((await cli(['verify', plain, '--fail-on-unknown'])).code).toBe(3);
  });

  test('a malformed receipt does not verify', async () => {
    await cli(['write']);
    const env = JSON.parse(note(sha));
    setNote(sha, JSON.stringify({ ...env, payload: Buffer.from('not json').toString('base64') }));
    expect((await cli(['verify'])).code).toBe(1);
  });

  test('an unsigned receipt says it proves nothing about who wrote it', async () => {
    // Signer level `none` is a self-reported log: rewritten consistently, it
    // still verifies. That is the documented limit, and the output says so.
    await cli(['write']);
    const env = JSON.parse(note(sha));
    const stmt = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
    stmt.predicate.touched.written.items = ['innocent.txt'];
    env.payload = Buffer.from(JSON.stringify(stmt)).toString('base64');
    setNote(sha, JSON.stringify(env));
    const v = await cli(['verify']);
    expect(v.code).toBe(0);
    expect(v.out).toContain('signer none');
  });

  test('a receipt moved to another commit does not verify', async () => {
    await cli(['write']);
    const other = commitAt(repo, 3000, 'c.txt');
    setNote(other, note(sha));
    const v = await cli(['verify', other]);
    expect(v.code).toBe(1);
    expect(v.out).toContain('different commit');
  });

  test('a receipt claiming a signature it does not carry does not verify', async () => {
    await cli(['write']);
    const env = JSON.parse(note(sha));
    const stmt = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
    stmt.predicate.signer = 'local-keychain';
    env.payload = Buffer.from(JSON.stringify(stmt)).toString('base64');
    setNote(sha, JSON.stringify(env));
    const v = await cli(['verify']);
    expect(v.code).toBe(1);
    expect(v.out).toContain('no signature verifies');
  });

  test('a receipt for a different policy does not verify', async () => {
    await cli(['write']);
    // Same commit, but pretend the receipt was written under some policy.
    const env = JSON.parse(note(sha));
    const stmt = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
    stmt.predicate.policy_sha256 = `sha256:${'b'.repeat(64)}`;
    env.payload = Buffer.from(JSON.stringify(stmt)).toString('base64');
    setNote(sha, JSON.stringify(env));
    expect((await cli(['verify'])).code).toBe(1);
  });

  test('write refuses a session log that does not verify', async () => {
    const path = logPath(dataDir, 's1');
    writeFileSync(path, readFileSync(path, 'utf8').replace('b.txt', 'z.txt'));
    expect((await cli(['write'])).code).toBe(1);
  });

  test('outside a git repository it is a usage error', async () => {
    repo = root;
    expect((await cli(['show'])).code).toBe(2);
  });
});
