import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { appendEvent, ensureMeta } from '../src/log/store';
import { readNote, writeNote } from '../src/receipt/git';
import { commitAt } from './helpers/git';

let root: string;
let repo: string;
let dataDir: string;
const at = (s: number) => new Date((1_700_000_000 + s) * 1000 + 100);

async function cli(args: string[]) {
  const out: string[] = [];
  const io = {
    stdout: { write: (s: string) => void out.push(s) },
    stderr: { write: (s: string) => void out.push(s) },
    env: { AGORA_HOME: dataDir, NO_COLOR: '1', HOME: root },
    cwd: repo
  };
  return { code: await runCli(args, io as never), out: out.join('') };
}

let agent: string;
let byHand: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'agora-report-'));
  repo = join(root, 'repo');
  dataDir = join(root, 'agora');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  byHand = commitAt(repo, 1000, 'a.txt');
  ensureMeta(dataDir, 's1', repo);
  appendEvent(
    dataDir,
    's1',
    { host: 'opencode', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
    at(1500)
  );
  appendEvent(
    dataDir,
    's1',
    { host: 'opencode', kind: 'exec', subject: 'curl', decision: 'denied' },
    at(1600)
  );
  agent = commitAt(repo, 2000, 'b.txt');
  await cli(['receipt', 'write', agent]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('agora report', () => {
  test('summarises receipts from git notes alone, and calls a missing one not established', async () => {
    const r = await cli(['report', '--json']);
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out);
    expect(report.totals).toMatchObject({
      commits: 2,
      valid: 1,
      missing: 1,
      invalid: 0,
      sessions: 1,
      denied: 1,
      files_written: 1,
      by_host: { opencode: 1 }
    });
    expect(report.commits.find((c: { sha: string }) => c.sha === byHand).state).toBe('missing');
    expect(report.not_enforced.some((n: string) => n.startsWith('opencode: '))).toBe(true);
  });

  test('writes one self-contained HTML file with no scripts', async () => {
    const r = await cli(['report', '--out', join(root, 'r.html')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1 of 2 commits carry a receipt that verifies');
    const html = readFileSync(join(root, 'r.html'), 'utf8');
    expect(html).toContain('not established');
    expect(html).toContain('not a statement of compliance');
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3)/);
  });

  test('a tampered receipt is rejected and the report exits 1', async () => {
    const env = JSON.parse(readNote(repo, agent) as string);
    env.payload = Buffer.from('{"bad":true}').toString('base64');
    writeNote(repo, agent, JSON.stringify(env));
    const r = await cli(['report', '--json']);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out).totals.invalid).toBe(1);
  });

  test('commit subjects are escaped', async () => {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        '<img src=x onerror=alert(1)>'
      ],
      { cwd: repo }
    );
    await cli(['report', '--out', join(root, 'r.html')]);
    expect(readFileSync(join(root, 'r.html'), 'utf8')).toContain('&lt;img src=x');
  });

  test('outside a git repository it is a usage error', async () => {
    repo = root;
    expect((await cli(['report'])).code).toBe(2);
  });

  test('a bare --since date covers the whole day', async () => {
    const { buildReport } = await import('../src/report/build');
    // commitAt dates are in November 2023; the day of the first commit covers both.
    const day = execFileSync('git', ['log', '--reverse', '--format=%cs'], {
      cwd: repo,
      encoding: 'utf8'
    }).split('\n')[0] as string;
    const r = await buildReport({ repo, name: 'r', since: day, until: day });
    expect(r.totals.commits).toBe(2);
  });
});
