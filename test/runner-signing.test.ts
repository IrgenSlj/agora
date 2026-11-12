import { describe, expect, test } from 'vitest';
import { envelope, statement } from '../src/evidence/dsse';
import { parseRunners } from '../src/receipt/keys';
import { RECEIPT_PREDICATE_TYPE } from '../src/receipt/predicate';
import { verifyReceipt } from '../src/receipt/verify';
import { signerAvailable } from '../src/signer/client';
import { GITHUB_OIDC_ISSUER, runnerAvailable, runnerIdentity } from '../src/signer/runner';

const SHA = 'a'.repeat(40);
const WORKFLOW = 'https://github.com/acme/app/.github/workflows/agent.yml@refs/heads/main';

const predicate = (signer: string) => ({
  window: { from: 'x', to: 'y' },
  sessions: [
    { id: 's', host: 'opencode', seq: 0, head: `sha256:${'c'.repeat(64)}`, events: 1, closed: true }
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
  signer
});

const env = (signer = 'runner-oidc') =>
  envelope(
    statement(
      [{ name: 'git:commit', digest: { gitCommit: SHA } }],
      RECEIPT_PREDICATE_TYPE,
      predicate(signer)
    )
  );
const bundle = (signer = 'runner-oidc') =>
  JSON.stringify({
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {},
    dsseEnvelope: env(signer)
  });

const runners = [{ issuer: GITHUB_OIDC_ISSUER, identity: WORKFLOW }];
/** Stands in for Sigstore: accepts only the given workflow identity. */
const acceptOnly =
  (identity: string) => async (_b: unknown, o: { certificateIdentityURI: string }) => {
    if (o.certificateIdentityURI !== identity) throw new Error('identity mismatch');
    return {};
  };
const ctx = { policySha256: null, trusted: [], runners };

describe('runner-signed receipts', () => {
  test('a bundle signed by a trusted workflow verifies at runner-oidc', async () => {
    const v = await verifyReceipt(bundle(), SHA, { ...ctx, verifyBundle: acceptOnly(WORKFLOW) });
    expect(v).toMatchObject({ valid: true, level: 'runner-oidc', runner: WORKFLOW });
  });

  test('a bundle signed by another workflow does not verify', async () => {
    const v = await verifyReceipt(bundle(), SHA, {
      ...ctx,
      verifyBundle: acceptOnly(
        'https://github.com/evil/fork/.github/workflows/x.yml@refs/heads/main'
      )
    });
    expect(v.valid).toBe(false);
    expect(v.problems[0]).toContain('no trusted runner signed');
  });

  test('with no trusted runner, a runner signature proves nothing', async () => {
    const v = await verifyReceipt(bundle(), SHA, {
      ...ctx,
      runners: [],
      verifyBundle: acceptOnly(WORKFLOW)
    });
    expect(v.valid).toBe(false);
    expect(v.problems[0]).toContain('trusts no runner');
  });

  test('a plain envelope claiming a runner signature does not verify', async () => {
    const v = await verifyReceipt(JSON.stringify(env()), SHA, {
      ...ctx,
      verifyBundle: acceptOnly(WORKFLOW)
    });
    expect(v.valid).toBe(false);
    expect(v.problems[0]).toContain('no Sigstore bundle');
  });

  test('an unsigned receipt inside a bundle is still read as unsigned', async () => {
    const v = await verifyReceipt(bundle('none'), SHA, ctx);
    expect(v).toMatchObject({ valid: true, level: 'none' });
  });

  test('runner identities come from .agora/signers.json', () => {
    expect(parseRunners(JSON.stringify({ keys: [], runners }))).toEqual(runners);
    expect(parseRunners(JSON.stringify({ keys: [] }))).toEqual([]);
    expect(parseRunners('{not json')).toEqual([]);
  });

  test('a GitHub runner with an OIDC token signs at runner-oidc', async () => {
    const gh = {
      GITHUB_ACTIONS: 'true',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://x',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 't',
      GITHUB_WORKFLOW_REF: 'acme/app/.github/workflows/agent.yml@refs/heads/main'
    };
    expect(runnerAvailable(gh)).toBe(true);
    expect(runnerIdentity(gh)).toBe(WORKFLOW);
    expect(await signerAvailable(gh, undefined)).toBe('runner-oidc');
    expect(runnerAvailable({ GITHUB_ACTIONS: 'true' })).toBe(false);
  });
});

describe('agora signer trust --workflow', () => {
  test('adds the workflow identity from the GitHub remote, once', async () => {
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runCli } = await import('../src/cli/app');
    const repo = mkdtempSync(join(tmpdir(), 'agora-runner-trust-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], {
        cwd: repo
      });
      const run = async (args: string[]) => {
        const out: string[] = [];
        const io = {
          stdout: { write: (s: string) => void out.push(s) },
          stderr: { write: (s: string) => void out.push(s) },
          env: { HOME: repo, AGORA_KEYCHAIN: join(repo, 'kc'), NO_COLOR: '1' },
          cwd: repo
        };
        return { code: await runCli(['signer', ...args], io as never), out: out.join('') };
      };
      expect((await run(['trust', '--workflow', 'agent.yml'])).code).toBe(0);
      expect((await run(['trust', '--workflow', 'agent.yml'])).out).toContain('Already trusted');
      const doc = JSON.parse(readFileSync(join(repo, '.agora', 'signers.json'), 'utf8'));
      expect(doc.runners).toEqual([{ issuer: GITHUB_OIDC_ISSUER, identity: WORKFLOW }]);
      expect((await run(['trust', '--workflow', '../x.yml'])).code).toBe(2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
