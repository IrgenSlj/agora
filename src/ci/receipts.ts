// The receipts check: was each commit in this change made within policy?
//
// Each commit's receipt (refs/notes/agora) is verified against the policy
// at that commit and against keys trusted at the base of the range, never at
// its head, so a pull request cannot add the key that vouches for it.

import { readFileSync } from 'node:fs';
import { policyShaAt, trustedKeysAt } from '../cli/commands/receipt.js';
import { commitsIn, readNote, repoRoot, resolveCommit } from '../receipt/git.js';
import type { SignerLevel } from '../receipt/predicate.js';
import { receiptLines } from '../receipt/render.js';
import { verifyReceipt } from '../receipt/verify.js';
import type { CiCheck, CiFinding } from './report.js';

const RANK: Record<SignerLevel, number> = { none: 0, 'local-keychain': 1, 'runner-oidc': 2 };

export interface ReceiptCommit {
  sha: string;
  state: 'valid' | 'invalid' | 'missing';
  level?: SignerLevel;
  problems: string[];
  lines: string[];
}

/** `base..head` from a GitHub pull_request or push event, when there is one. */
export function rangeFromGithubEvent(env: Record<string, string | undefined>): string | undefined {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) return undefined;
  try {
    const event = JSON.parse(readFileSync(path, 'utf8'));
    const base = event?.pull_request?.base?.sha ?? event?.before;
    const head = event?.pull_request?.head?.sha ?? event?.after;
    const ok = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{40}$/.test(s) && !/^0+$/.test(s);
    return ok(base) && ok(head) ? `${base}..${head}` : undefined;
  } catch {
    return undefined;
  }
}

export function receiptsCheck(opts: { cwd: string; range?: string; requireSigner?: SignerLevel }): {
  check: CiCheck;
  commits: ReceiptCommit[];
} {
  const none = (summary: string) => ({
    check: { name: 'receipts' as const, state: 'not_established' as const, summary, findings: [] },
    commits: []
  });
  const repo = repoRoot(opts.cwd);
  if (!repo) return none('not a git repository');
  if (!opts.range)
    return none('no commit range: pass --range base..head, or run on a pull request');
  const [baseRev] = opts.range.split('..');
  const base = baseRev ? resolveCommit(repo, baseRev) : undefined;

  let shas: string[];
  try {
    shas = commitsIn(repo, opts.range);
  } catch {
    return none(`could not read the range ${opts.range}; is the checkout deep enough?`);
  }
  if (!shas.length) return none('no commits in range');

  const trusted = trustedKeysAt(repo, base);
  const commits: ReceiptCommit[] = shas.map((sha) => {
    const note = readNote(repo, sha);
    if (!note) return { sha, state: 'missing', problems: [], lines: [] };
    const v = verifyReceipt(note, sha, { policySha256: policyShaAt(repo, sha), trusted });
    const problems = [...v.problems];
    if (v.predicate && v.predicate.canary_hits > 0) {
      problems.push(`${v.predicate.canary_hits} canary hit(s): an agent touched a decoy`);
    }
    if (v.valid && opts.requireSigner && RANK[v.level] < RANK[opts.requireSigner]) {
      problems.push(`signed at ${v.level}; this check requires ${opts.requireSigner}`);
    }
    return {
      sha,
      state: v.valid && problems.length === 0 ? 'valid' : 'invalid',
      level: v.level,
      problems,
      lines: v.predicate ? receiptLines(v.predicate) : []
    };
  });

  const invalid = commits.filter((c) => c.state === 'invalid');
  const missing = commits.filter((c) => c.state === 'missing');
  const findings: CiFinding[] = [
    ...invalid.map((c) => ({
      title: `receipt rejected — ${c.sha.slice(0, 12)}`,
      detail: c.problems.join('; ')
    })),
    ...missing.map((c) => ({
      title: `no receipt — ${c.sha.slice(0, 12)}`,
      detail: 'No receipt: not established. Made by hand, or the receipt was not pushed.'
    }))
  ];
  const n = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;
  const state = invalid.length ? 'fail' : missing.length ? 'not_established' : 'pass';
  const summary = invalid.length
    ? `${n(invalid.length, 'commit')} with a rejected receipt, of ${shas.length}`
    : `${commits.length - missing.length} of ${n(shas.length, 'commit')} carry a valid receipt` +
      (missing.length ? `; ${missing.length} not established` : '');

  return { check: { name: 'receipts', state, summary, findings }, commits };
}
