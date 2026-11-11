import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { rangeFromGithubEvent, receiptsCheck } from '../src/ci/receipts';
import { runCli } from '../src/cli/app';
import { envelope } from '../src/evidence/dsse';
import { appendEvent, ensureMeta } from '../src/log/store';
import { buildReceipt } from '../src/receipt/build';
import { writeNote } from '../src/receipt/git';
import { generateKey, identityOf, signWith } from '../src/signer/client';
import { commitAt } from './helpers/git';

let root: string;
let repo: string;
let dataDir: string;
let base: string;
const at = (s: number) => new Date((1_700_000_000 + s) * 1000 + 100);

function agentCommit(seconds: number, file: string, opts: { sign?: Buffer } = {}): string {
  appendEvent(
    dataDir,
    's1',
    { host: 'claude-code', kind: 'file_write', subject: file, decision: 'allowed' },
    at(seconds - 10)
  );
  const sha = commitAt(repo, seconds, file);
  const built = buildReceipt({ dataDir, repo, sha, signer: opts.sign ? 'local-keychain' : 'none' });
  if (built.status !== 'built') throw new Error(built.status);
  let env = envelope(built.statement);
  if (opts.sign) env = signWith(env, opts.sign);
  writeNote(repo, sha, JSON.stringify(env));
  return sha;
}

function trustKey(key: Buffer, seconds: number): string {
  mkdirSync(join(repo, '.agora'), { recursive: true });
  writeFileSync(join(repo, '.agora', 'signers.json'), JSON.stringify({ keys: [identityOf(key)] }));
  return commitAt(
    repo,
    seconds,
    '.agora/signers.json',
    JSON.stringify({ keys: [identityOf(key)] })
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agora-ci-receipts-'));
  repo = join(root, 'repo');
  dataDir = join(root, 'agora');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  ensureMeta(dataDir, 's1', repo);
  base = commitAt(repo, 1000, 'readme.md');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('receipts check', () => {
  test('every commit with a valid receipt passes', () => {
    const head = agentCommit(2000, 'a.ts');
    const { check, commits } = receiptsCheck({ cwd: repo, range: `${base}..${head}` });
    expect(check.state).toBe('pass');
    expect(commits.map((c) => c.state)).toEqual(['valid']);
  });

  test('a commit with no receipt is not established, never a pass', () => {
    agentCommit(2000, 'a.ts');
    const head = commitAt(repo, 3000, 'by-hand.ts');
    const { check } = receiptsCheck({ cwd: repo, range: `${base}..${head}` });
    expect(check.state).toBe('not_established');
    expect(check.summary).toContain('1 of 2 commits carry a valid receipt');
  });

  test('a signed receipt changed after signing fails the check', () => {
    const key = generateKey();
    const trustedBase = trustKey(key, 1500);
    const head = agentCommit(2000, 'a.ts', { sign: key });
    expect(receiptsCheck({ cwd: repo, range: `${trustedBase}..${head}` }).check.state).toBe('pass');

    const note = execFileSync('git', ['notes', '--ref=refs/notes/agora', 'show', head], {
      cwd: repo,
      encoding: 'utf8'
    });
    const env = JSON.parse(note);
    const stmt = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
    stmt.predicate.touched.written.items = ['harmless.ts'];
    env.payload = Buffer.from(JSON.stringify(stmt)).toString('base64');
    writeNote(repo, head, JSON.stringify(env));
    expect(receiptsCheck({ cwd: repo, range: `${trustedBase}..${head}` }).check.state).toBe('fail');
  });

  test('a pull request cannot add the key that vouches for it', () => {
    const key = generateKey();
    // The key is trusted only inside the range being checked, not at its base.
    trustKey(key, 1500);
    const head = agentCommit(2000, 'a.ts', { sign: key });
    const { check } = receiptsCheck({ cwd: repo, range: `${base}..${head}` });
    expect(check.state).toBe('fail');
  });

  test('--require-signer rejects unsigned receipts', () => {
    const head = agentCommit(2000, 'a.ts');
    const { check } = receiptsCheck({
      cwd: repo,
      range: `${base}..${head}`,
      requireSigner: 'local-keychain'
    });
    expect(check.state).toBe('fail');
  });

  test('no range is not established', () => {
    expect(receiptsCheck({ cwd: repo }).check.state).toBe('not_established');
  });

  test('reads the range from a GitHub pull_request event', () => {
    const path = join(root, 'event.json');
    writeFileSync(
      path,
      JSON.stringify({
        pull_request: { base: { sha: 'a'.repeat(40) }, head: { sha: 'b'.repeat(40) } }
      })
    );
    expect(rangeFromGithubEvent({ GITHUB_EVENT_PATH: path })).toBe(
      `${'a'.repeat(40)}..${'b'.repeat(40)}`
    );
    writeFileSync(path, JSON.stringify({ before: '0'.repeat(40), after: 'b'.repeat(40) }));
    expect(rangeFromGithubEvent({ GITHUB_EVENT_PATH: path })).toBeUndefined();
  });

  test('agora ci exits 1 on a rejected receipt and writes the receipt into the job summary', async () => {
    const head = agentCommit(2000, 'a.ts');
    const summary = join(root, 'summary.md');
    writeFileSync(summary, '');
    const out: string[] = [];
    const io = {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { HOME: root, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary },
      cwd: repo,
      fetcher: (() => Promise.resolve(new Response(JSON.stringify({ results: [] })))) as never
    };
    expect(await runCli(['ci', '--range', `${base}..${head}`], io as never)).toBe(0);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(summary, 'utf8')).toContain('receipt verifies');
    expect(readFileSync(summary, 'utf8')).toContain('wrote      a.ts');

    writeNote(repo, head, '{"not":"a receipt"}');
    expect(await runCli(['ci', '--range', `${base}..${head}`], io as never)).toBe(1);
  });
});
