// Values the hook hot path needs without loading zod (about 18 ms at startup).

export const EVENT_VERSION = 1 as const;

/** The `prev` of a session's first event. */
export const GENESIS = `sha256:${'0'.repeat(64)}`;

/** Mirrors `EventSubject` in schema.ts: bounded, single line, no control characters. */
export const SUBJECT = /^[^\u0000-\u001f\u007f]{1,256}$/;
