// AgentEvent: one line of the session log, the record everything else reads.
//
// Learn, compile, receipt and replay are all readers of a log of these
// (docs/PLAN.md). The shape is deliberately narrow, because the one thing this
// record must never become is a transcript of what the agent saw:
//
//   - no tool arguments, tool results, prompt text or file contents;
//   - a command is recorded as its program name only, never its arguments;
//   - a path inside the repository is stored relative; outside it, only as a
//     class (`class:home`, `class:system`, `class:tmp`, `class:other`);
//   - a network peer is `host:port`, never a URL with its path or query.
//
// The object is strict, so a field that could carry content cannot be added
// without changing this file and the test that pins its keys.

import { z } from 'zod';

export const EVENT_VERSION = 1 as const;

const Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/, 'sha256:<64 hex>');

export const EventHost = z.enum(['claude-code', 'opencode', 'mcp-shim']);
export type EventHost = z.infer<typeof EventHost>;

export const EventKind = z.enum([
  'session',
  'tool_call',
  'file_read',
  'file_write',
  'exec',
  'net',
  'approval',
  'canary'
]);
export type EventKind = z.infer<typeof EventKind>;

export const EventDecision = z.enum(['allowed', 'denied', 'asked']);
export type EventDecision = z.infer<typeof EventDecision>;

/**
 * What the event is about, in the per-kind form described above. Bounded and
 * single-line: a subject is an identifier, not a place to put text.
 */
export const EventSubject = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'no control characters or newlines');

export const AgentEvent = z
  .object({
    v: z.literal(EVENT_VERSION),
    session: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    seq: z.number().int().min(0),
    ts: z.iso.datetime(),
    host: EventHost,
    kind: EventKind,
    subject: EventSubject,
    /** Absent on `session` markers, which record no decision. */
    decision: EventDecision.optional(),
    /** Hash of the previous event in this session; GENESIS for the first. */
    prev: Digest,
    /** sha256 over the canonical JSON of every other field. */
    hash: Digest
  })
  .strict();
export type AgentEvent = z.infer<typeof AgentEvent>;

/** The `prev` of a session's first event. */
export const GENESIS = `sha256:${'0'.repeat(64)}`;

/** The event before it is chained: what a normaliser produces. */
export type EventDraft = Pick<AgentEvent, 'host' | 'kind' | 'subject'> & {
  decision?: EventDecision;
};

/** JSON Schema for consumers that do not read TypeScript. */
export function agentEventJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://github.com/IrgenSlj/agora/schemas/agent-event.v1.json',
    title: 'AgentEvent',
    ...(z.toJSONSchema(AgentEvent) as Record<string, unknown>)
  };
}
