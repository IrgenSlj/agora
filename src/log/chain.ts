// The hash chain over a session's events. Pure: no clock, no filesystem.
//
// Each event's `hash` is sha256 over the canonical JSON of every other field,
// and each event's `prev` is the previous event's hash. Changing any byte of
// any event breaks either its own hash or the next event's `prev`. Removing
// events from the end cannot be detected from the chain alone; that is what the
// root recorded on close, and later the signed receipt, are for.

import { AgentEvent, EVENT_VERSION, type EventDraft, GENESIS } from '../events/schema.js';
import { canonicalJson, sha256Hex } from '../model/hash.js';

export function eventHash(event: Omit<AgentEvent, 'hash'>): string {
  return `sha256:${sha256Hex(canonicalJson(event))}`;
}

/** Appends `draft` after `last` (or starts the chain), returning the full event. */
export function chainEvent(
  session: string,
  last: Pick<AgentEvent, 'seq' | 'hash'> | undefined,
  draft: EventDraft,
  now: Date
): AgentEvent {
  const body: Omit<AgentEvent, 'hash'> = {
    v: EVENT_VERSION,
    session,
    seq: last ? last.seq + 1 : 0,
    ts: now.toISOString(),
    host: draft.host,
    kind: draft.kind,
    subject: draft.subject,
    ...(draft.decision ? { decision: draft.decision } : {}),
    prev: last ? last.hash : GENESIS
  };
  return AgentEvent.parse({ ...body, hash: eventHash(body) });
}

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
