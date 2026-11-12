import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { decodeStatement, envelope } from '../src/evidence/dsse';
import { appendEvent, ensureMeta, logPath } from '../src/log/store';
import { buildReceipt } from '../src/receipt/build';
import { ReceiptPredicate } from '../src/receipt/predicate';
import { commitAt } from './helpers/git';

let root: string;
let repo: string;
let dataDir: string;

const BASE = 1_700_000_000;
const at = (seconds: number) => new Date((BASE + seconds) * 1000 + 100);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agora-receipt-'));
  repo = join(root, 'repo');
  dataDir = join(root, 'agora');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('buildReceipt', () => {
  test('binds only the sessions in this repository and this commit window', () => {
    const c1 = commitAt(repo, 1000, 'a.txt');
    // In window (1000, 2000]: belongs to c2.
    ensureMeta(dataDir, 's-in', repo);
    appendEvent(
      dataDir,
      's-in',
      { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      at(1500)
    );
    appendEvent(
      dataDir,
      's-in',
      { host: 'claude-code', kind: 'exec', subject: 'git', decision: 'allowed' },
      at(1600)
    );
    appendEvent(
      dataDir,
      's-in',
      {
        host: 'claude-code',
        kind: 'tool_call',
        subject: 'mcp:github/create_issue',
        decision: 'denied'
      },
      at(1700)
    );
    // After the commit: not part of it.
    appendEvent(
      dataDir,
      's-in',
      { host: 'claude-code', kind: 'file_write', subject: 'later.txt', decision: 'allowed' },
      at(2500)
    );
    // Before the parent: belongs to c1, not c2.
    ensureMeta(dataDir, 's-early', repo);
    appendEvent(
      dataDir,
      's-early',
      { host: 'claude-code', kind: 'file_write', subject: 'a.txt', decision: 'allowed' },
      at(900)
    );
    // Another repository.
    ensureMeta(dataDir, 's-other', join(root));
    appendEvent(
      dataDir,
      's-other',
      { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      at(1500)
    );
    const c2 = commitAt(repo, 2000, 'b.txt');

    const r = buildReceipt({ dataDir, repo, sha: c2 });
    expect(r.status).toBe('built');
    if (r.status !== 'built') return;
    expect(ReceiptPredicate.safeParse(r.predicate).success).toBe(true);
    expect(r.predicate.sessions.map((s) => s.id)).toEqual(['s-in']);
    expect(r.predicate.sessions[0]).toMatchObject({ seq: 2, events: 3, closed: false });
    expect(r.predicate.touched.written.items).toEqual(['b.txt']);
    expect(r.predicate.touched.commands.items).toEqual(['git']);
    // The github call was denied, so it never reached the server.
    expect(r.predicate.servers).toEqual([]);
    expect(r.predicate.touched.tools.items).toEqual([]);
    expect(r.predicate.denied).toBe(1);
    expect(r.predicate.policy_sha256).toBeNull();
    expect(r.statement.subject).toEqual([{ name: 'git:commit', digest: { gitCommit: c2 } }]);
    expect(decodeStatement(envelope(r.statement)).predicateType).toBe(
      'https://github.com/IrgenSlj/agora/receipt/v1'
    );

    const first = buildReceipt({ dataDir, repo, sha: c1 });
    expect(first.status === 'built' && first.predicate.sessions.map((s) => s.id)).toEqual([
      's-early'
    ]);
  });

  test('a commit with no agent activity has no receipt', () => {
    commitAt(repo, 1000, 'a.txt');
    const c2 = commitAt(repo, 2000, 'b.txt');
    expect(buildReceipt({ dataDir, repo, sha: c2 }).status).toBe('no-sessions');
  });

  test('refuses to summarise a session whose log has been tampered with', () => {
    commitAt(repo, 1000, 'a.txt');
    ensureMeta(dataDir, 's', repo);
    appendEvent(
      dataDir,
      's',
      { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      at(1500)
    );
    appendEvent(
      dataDir,
      's',
      { host: 'claude-code', kind: 'exec', subject: 'rm', decision: 'allowed' },
      at(1600)
    );
    const c2 = commitAt(repo, 2000, 'b.txt');
    const path = logPath(dataDir, 's');
    writeFileSync(path, readFileSync(path, 'utf8').replace('"rm"', '"ls"'));
    const r = buildReceipt({ dataDir, repo, sha: c2 });
    expect(r.status).toBe('log-invalid');
  });

  test('records the hash of agora.cedar at the commit', () => {
    commitAt(repo, 1000, 'agora.cedar', 'forbid (principal, action, resource);');
    ensureMeta(dataDir, 's', repo);
    appendEvent(
      dataDir,
      's',
      { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      at(1500)
    );
    const c2 = commitAt(repo, 2000, 'b.txt');
    const r = buildReceipt({ dataDir, repo, sha: c2 });
    expect(r.status === 'built' && r.predicate.policy_sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('lists what each host in the commit could not enforce, and only those hosts', () => {
    commitAt(repo, 1000, 'a.txt');
    ensureMeta(dataDir, 'oc', repo);
    appendEvent(
      dataDir,
      'oc',
      { host: 'opencode', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      at(1500)
    );
    const c2 = commitAt(repo, 2000, 'b.txt');
    const r = buildReceipt({ dataDir, repo, sha: c2 });
    if (r.status !== 'built') throw new Error(r.status);
    const gaps = r.predicate.not_enforced;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.startsWith('opencode: '))).toBe(true);
    expect(gaps.some((g) => g.includes('MCP tools'))).toBe(true);
  });
});
