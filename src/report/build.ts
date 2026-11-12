// `agora report`: an evidence report for a repository and a date range, built
// from the receipts in git notes and nothing else. No server, no account.
//
// It states what the receipts prove and what they do not: a commit without a
// receipt is "not established", never "clean", and every host gap the receipts
// list is repeated here (AGENTS.md rule 5). It makes no compliance claim.

import { policyShaAt, trustedKeysAt, trustedRunnersAt } from '../cli/commands/receipt.js';
import { git, readNote } from '../receipt/git.js';
import type { ReceiptPredicate, SignerLevel } from '../receipt/predicate.js';
import { verifyReceipt } from '../receipt/verify.js';

export interface ReportCommit {
  sha: string;
  date: string;
  subject: string;
  state: 'valid' | 'invalid' | 'missing';
  level?: SignerLevel;
  problems: string[];
  predicate?: ReceiptPredicate;
}

export interface Report {
  repository: string;
  rev: string;
  since: string | null;
  until: string | null;
  generated: string;
  commits: ReportCommit[];
  totals: {
    commits: number;
    valid: number;
    invalid: number;
    missing: number;
    by_signer: Record<SignerLevel, number>;
    by_host: Record<string, number>;
    sessions: number;
    denied: number;
    canary_hits: number;
    files_written: number;
    policies: string[];
  };
  not_enforced: string[];
}

export async function buildReport(opts: {
  repo: string;
  name: string;
  rev?: string;
  since?: string;
  until?: string;
  now?: Date;
}): Promise<Report> {
  const rev = opts.rev ?? 'HEAD';
  const args = ['log', '--format=%H%x09%cI%x09%s', '--no-merges'];
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);
  args.push(rev, '--');
  const out = git(opts.repo, args);
  // Keys trusted at the reported revision, the same rule `agora ci` applies.
  const trusted = trustedKeysAt(opts.repo, rev);

  const runners = trustedRunnersAt(opts.repo, rev);
  const commits: ReportCommit[] = [];
  for (const line of out ? out.split('\n') : []) commits.push(await reportCommit(line));
  async function reportCommit(line: string): Promise<ReportCommit> {
    const [sha = '', date = '', ...rest] = line.split('\t');
    const base = { sha, date, subject: rest.join('\t') };
    const note = readNote(opts.repo, sha);
    if (!note) return { ...base, state: 'missing', problems: [] };
    const v = await verifyReceipt(note, sha, {
      policySha256: policyShaAt(opts.repo, sha),
      trusted,
      runners
    });
    const problems = [...v.problems];
    if (v.predicate && v.predicate.canary_hits > 0)
      problems.push(`${v.predicate.canary_hits} canary hit(s): an agent touched a decoy`);
    return {
      ...base,
      state: v.valid && problems.length === 0 ? 'valid' : 'invalid',
      level: v.level,
      problems,
      ...(v.predicate ? { predicate: v.predicate } : {})
    };
  }

  const withReceipt = commits.filter((c) => c.predicate);
  const preds = withReceipt.map((c) => c.predicate as ReceiptPredicate);
  const by_signer: Record<SignerLevel, number> = { none: 0, 'local-keychain': 0, 'runner-oidc': 0 };
  for (const c of commits) if (c.state === 'valid' && c.level) by_signer[c.level]++;
  const by_host: Record<string, number> = {};
  const sessions = new Set<string>();
  for (const p of preds)
    for (const s of p.sessions) {
      if (sessions.has(s.id)) continue;
      sessions.add(s.id);
      by_host[s.host] = (by_host[s.host] ?? 0) + 1;
    }
  const written = new Set(preds.flatMap((p) => p.touched.written.items));
  const policies = [...new Set(preds.map((p) => p.policy_sha256 ?? 'none'))];

  return {
    repository: opts.name,
    rev,
    since: opts.since ?? null,
    until: opts.until ?? null,
    generated: (opts.now ?? new Date()).toISOString(),
    commits,
    totals: {
      commits: commits.length,
      valid: commits.filter((c) => c.state === 'valid').length,
      invalid: commits.filter((c) => c.state === 'invalid').length,
      missing: commits.filter((c) => c.state === 'missing').length,
      by_signer,
      by_host,
      sessions: sessions.size,
      denied: preds.reduce((n, p) => n + p.denied, 0),
      canary_hits: preds.reduce((n, p) => n + p.canary_hits, 0),
      files_written: written.size,
      policies
    },
    not_enforced: [...new Set(preds.flatMap((p) => p.not_enforced))].sort()
  };
}
