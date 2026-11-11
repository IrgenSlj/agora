// Verifying a session log. Loads the full schema, so it stays off the hook's
// hot path: hooks only append, people and CI verify.

import { existsSync, readFileSync } from 'node:fs';
import { GENESIS } from '../events/constants.js';
import { AgentEvent } from '../events/schema.js';
import { eventHash } from './chain.js';
import { logPath, readRoot } from './store.js';

export interface ChainProblem {
  /** 1-based line number in the log file. */
  line: number;
  problem: string;
}

export interface ChainVerdict {
  ok: boolean;
  events: number;
  /** Hash of the last valid event, or undefined for an empty log. */
  head?: string;
  problems: ChainProblem[];
}

/**
 * Verifies a session log given as its raw lines. Every line must parse, match
 * the schema, belong to `session`, carry the next sequence number, point at
 * the previous hash, and hash to itself.
 */
export function verifyLines(session: string, lines: readonly string[]): ChainVerdict {
  const problems: ChainProblem[] = [];
  let prev = GENESIS;
  let seq = 0;
  let count = 0;

  lines.forEach((raw, i) => {
    const line = i + 1;
    if (raw === '') {
      // Only a trailing newline is allowed to produce an empty last line.
      if (i !== lines.length - 1) problems.push({ line, problem: 'empty line inside the log' });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      problems.push({ line, problem: 'not valid JSON' });
      return;
    }
    const result = AgentEvent.safeParse(parsed);
    if (!result.success) {
      problems.push({
        line,
        problem: `does not match the AgentEvent schema: ${result.error.issues[0]?.message ?? ''}`
      });
      return;
    }
    const event = result.data;
    if (event.session !== session)
      problems.push({ line, problem: `belongs to session ${event.session}` });
    if (event.seq !== seq)
      problems.push({ line, problem: `sequence ${event.seq}, expected ${seq}` });
    if (event.prev !== prev)
      problems.push({ line, problem: 'prev does not match the previous event' });
    const { hash, ...body } = event;
    if (eventHash(body) !== hash) problems.push({ line, problem: 'hash does not match the event' });
    // Continue from what this line claims, so one edit reports once, not on
    // every line after it.
    prev = hash;
    seq = event.seq + 1;
    count++;
  });

  return { ok: problems.length === 0, events: count, ...(count ? { head: prev } : {}), problems };
}

export interface SessionVerdict extends ChainVerdict {
  session: string;
  /** closed: a root was recorded and matches. open: no root yet, so truncation is undetectable. */
  state: 'closed' | 'open';
}

export function verifySession(dataDir: string, session: string): SessionVerdict {
  const path = logPath(dataDir, session);
  if (!existsSync(path)) {
    return {
      session,
      state: 'open',
      ok: false,
      events: 0,
      problems: [{ line: 0, problem: 'no such session' }]
    };
  }
  const verdict = verifyLines(session, readFileSync(path, 'utf8').split('\n'));
  const root = readRoot(dataDir, session);
  if (!root) return { session, state: 'open', ...verdict };
  const problems = [...verdict.problems];
  if (verdict.head !== root.root || verdict.events !== root.seq + 1) {
    problems.push({
      line: verdict.events,
      problem: `log does not end at the recorded root (seq ${root.seq}); events were removed or added after close`
    });
  }
  return { session, state: 'closed', ...verdict, ok: problems.length === 0, problems };
}
