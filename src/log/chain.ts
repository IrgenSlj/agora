// The hash chain over a session's events. Pure: no clock, no filesystem.
//
// Each event's `hash` is sha256 over the canonical JSON of every other field,
// and each event's `prev` is the previous event's hash. Changing any byte of
// any event breaks either its own hash or the next event's `prev`. Removing
// events from the end cannot be detected from the chain alone; that is what the
// root recorded on close, and later the signed receipt, are for.

import { EVENT_VERSION, GENESIS, SUBJECT } from '../events/constants.js';
import type { AgentEvent, EventDraft } from '../events/schema.js';
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
  // Every other field is built here from typed values; the subject is the one
  // that came from outside, so it is the one checked. Full schema validation
  // happens on read (verify.ts), off the hook's hot path.
  if (!SUBJECT.test(body.subject)) throw new Error('event subject is not a bounded single line');
  return { ...body, hash: eventHash(body) };
}
