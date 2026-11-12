// Building a receipt for one commit from the local session logs.
//
// Binding rule (docs/PLAN.md, phase 2): a session belongs to a commit when it
// ran in the same working tree and has events after the parent commit and no
// later than this one. Only those events are summarised. A session whose log
// does not verify is never summarised: a receipt built from a tampered log
// would launder the tampering into a signed statement.

import { realpathSync } from 'node:fs';
import { receiptGaps } from '../compile/gaps.js';
import type { AgentEvent } from '../events/schema.js';
import { statement } from '../evidence/dsse.js';
import { listSessions, readEvents, readMeta, readRoot } from '../log/store.js';
import { verifySession } from '../log/verify.js';
import type { InTotoStatement } from '../model/attestation.js';
import { sha256Hex } from '../model/hash.js';
import { POLICY_FILE } from '../policy/engine.js';
import { commitWindow, fileAt } from './git.js';
import {
  RECEIPT_PREDICATE_TYPE,
  type ReceiptPredicate,
  type ReceiptSession,
  type SignerLevel
} from './predicate.js';

const CAP = 200;

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function capped(values: Iterable<string>): { items: string[]; truncated: boolean } {
  const items = [...new Set(values)].sort();
  return { items: items.slice(0, CAP), truncated: items.length > CAP };
}

export type BuildResult =
  | { status: 'built'; statement: InTotoStatement; predicate: ReceiptPredicate }
  | { status: 'no-sessions'; window: { from?: number; to: number } }
  | { status: 'log-invalid'; session: string; problems: string[] };

export function buildReceipt(input: {
  dataDir: string;
  repo: string;
  sha: string;
  signer?: SignerLevel;
}): BuildResult {
  const { dataDir, repo, sha } = input;
  const window = commitWindow(repo, sha);
  // Commit times have one-second precision; events have milliseconds.
  const to = window.to + 999;
  const from = window.from ?? Number.NEGATIVE_INFINITY;
  const root = real(repo);

  const sessions: ReceiptSession[] = [];
  const events: AgentEvent[] = [];
  for (const summary of listSessions(dataDir)) {
    const meta = readMeta(dataDir, summary.session);
    if (!meta?.git_root || real(meta.git_root) !== root) continue;
    const all = readEvents(dataDir, summary.session);
    const inWindow = all.filter((e) => {
      const t = Date.parse(e.ts);
      return t > from && t <= to;
    });
    if (!inWindow.length) continue;

    const verdict = verifySession(dataDir, summary.session);
    if (!verdict.ok) {
      return {
        status: 'log-invalid',
        session: summary.session,
        problems: verdict.problems.map((p) => `line ${p.line}: ${p.problem}`)
      };
    }
    const head = inWindow.at(-1) as AgentEvent;
    const closedRoot = readRoot(dataDir, summary.session);
    sessions.push({
      id: summary.session,
      host: head.host,
      seq: head.seq,
      head: head.hash,
      events: inWindow.length,
      closed: Boolean(closedRoot && closedRoot.seq === head.seq)
    });
    events.push(...inWindow);
  }

  if (!sessions.length) return { status: 'no-sessions', window };

  const of = (kind: AgentEvent['kind']) =>
    events.filter((e) => e.kind === kind).map((e) => e.subject);
  const servers = new Map<string, number>();
  for (const subject of of('tool_call')) {
    const m = /^mcp:([^/]+)\//.exec(subject);
    if (m?.[1]) servers.set(m[1], (servers.get(m[1]) ?? 0) + 1);
  }
  const policy = fileAt(repo, sha, POLICY_FILE);
  const hosts = [...new Set(sessions.map((s) => s.host))];

  const predicate: ReceiptPredicate = {
    window: {
      from: Number.isFinite(from) ? new Date(from).toISOString() : 'repository start',
      to: new Date(window.to).toISOString()
    },
    sessions,
    policy_sha256: policy ? `sha256:${sha256Hex(policy)}` : null,
    servers: [...servers.entries()].sort().map(([name, calls]) => ({ name, calls })),
    touched: {
      written: capped(of('file_write')),
      read: capped(of('file_read')),
      commands: capped(of('exec')),
      peers: capped(of('net')),
      tools: capped(of('tool_call'))
    },
    denied: events.filter((e) => e.decision === 'denied').length,
    canary_hits: events.filter((e) => e.kind === 'canary').length,
    not_enforced: receiptGaps(hosts),
    signer: input.signer ?? 'none'
  };

  return {
    status: 'built',
    predicate,
    statement: statement(
      [{ name: 'git:commit', digest: { gitCommit: sha } }],
      RECEIPT_PREDICATE_TYPE,
      predicate as unknown as Record<string, unknown>
    )
  };
}

export { POLICY_FILE };
