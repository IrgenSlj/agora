import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runCli } from '../src/cli/app';
import { envelope, statement } from '../src/evidence/dsse';
import { appendEvent, ensureMeta } from '../src/log/store';
import { parseSigners } from '../src/receipt/keys';
import { RECEIPT_PREDICATE_TYPE } from '../src/receipt/predicate';
import { verifyReceipt } from '../src/receipt/verify';
import { generateKey, identityOf, signWith } from '../src/signer/client';
import { commitAt } from './helpers/git';

const SHA = 'a'.repeat(40);
const predicate = {
  window: { from: 'x', to: 'y' },
  sessions: [
    {
      id: 's',
      host: 'claude-code',
      seq: 0,
      head: `sha256:${'c'.repeat(64)}`,
      events: 1,
      closed: false
    }
  ],
  policy_sha256: null,
  servers: [],
  touched: {
    written: { items: ['a.ts'], truncated: false },
    read: { items: [], truncated: false },
    commands: { items: [], truncated: false },
    peers: { items: [], truncated: false },
    tools: { items: [], truncated: false }
  },
  denied: 0,
  canary_hits: 0,
  not_enforced: [],
  signer: 'local-keychain'
};

function signed(key: Buffer, pred: Record<string, unknown> = predicate) {
  const stmt = statement(
    [{ name: 'git:commit', digest: { gitCommit: SHA } }],
    RECEIPT_PREDICATE_TYPE,
    pred
  );
  return signWith(envelope(stmt), key);
}
const trust = (key: Buffer) => parseSigners(JSON.stringify({ keys: [identityOf(key)] }));

describe('signed receipts', () => {
  const key = generateKey();

  test('a receipt signed by a trusted key verifies at local-keychain', async () => {
    const v = await verifyReceipt(JSON.stringify(signed(key)), SHA, {
      policySha256: null,
      trusted: trust(key)
    });
    expect(v).toMatchObject({ valid: true, level: 'local-keychain' });
  });

  test('changing a signed receipt fails verification', async () => {
    const env = signed(key);
    const stmt = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
    stmt.predicate.touched.written.items = ['innocent.ts'];
    const tampered = { ...env, payload: Buffer.from(JSON.stringify(stmt)).toString('base64') };
    const v = await verifyReceipt(JSON.stringify(tampered), SHA, {
      policySha256: null,
      trusted: trust(key)
    });
    expect(v.valid).toBe(false);
  });

  test('a signature from a key the repository does not trust proves nothing', async () => {
    const v = await verifyReceipt(JSON.stringify(signed(generateKey())), SHA, {
      policySha256: null,
      trusted: trust(key)
    });
    expect(v).toMatchObject({ valid: false, level: 'none' });
  });

  test('a signers entry whose id does not match its key is ignored', async () => {
    const id = identityOf(key);
    const other = identityOf(generateKey());
    expect(parseSigners(JSON.stringify({ keys: [{ ...id, keyid: other.keyid }] }))).toEqual([]);
  });
});

describe.runIf(process.platform === 'darwin')('macOS keychain, end to end', () => {
  let root: string;
  let keychain: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agora-signer-'));
    keychain = join(root, 'test.keychain-db');
    execFileSync('security', ['create-keychain', '-p', 'pw', keychain]);
    execFileSync('security', ['unlock-keychain', '-p', 'pw', keychain]);
  });
  afterEach(() => {
    execFileSync('security', ['delete-keychain', keychain]);
    rmSync(root, { recursive: true, force: true });
  });

  test('init, trust, write and verify produce a local-keychain receipt', async () => {
    const repo = join(root, 'repo');
    const dataDir = join(root, 'agora');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const out: string[] = [];
    const io = {
      stdout: { write: (s: string) => void out.push(s) },
      stderr: { write: (s: string) => void out.push(s) },
      env: { AGORA_KEYCHAIN: keychain, AGORA_HOME: dataDir, NO_COLOR: '1', PATH: process.env.PATH },
      cwd: repo
    };
    expect(await runCli(['signer', 'init'], io as never)).toBe(0);
    expect(await runCli(['signer', 'trust'], io as never)).toBe(0);
    commitAt(repo, 1000, '.agora/keep', '');
    ensureMeta(dataDir, 's1', repo);
    appendEvent(
      dataDir,
      's1',
      { host: 'claude-code', kind: 'file_write', subject: 'b.txt', decision: 'allowed' },
      new Date((1_700_000_000 + 1500) * 1000)
    );
    commitAt(repo, 2000, 'b.txt');
    expect(await runCli(['receipt', 'write'], io as never)).toBe(0);
    out.length = 0;
    expect(await runCli(['receipt', 'verify'], io as never)).toBe(0);
    expect(out.join('')).toContain('signer local-keychain');
  });
});
