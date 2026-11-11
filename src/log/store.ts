// Session logs on disk: `<dataDir>/sessions/<session>.jsonl`, one AgentEvent per
// line, plus `<session>.root` once the session is closed.
//
// Hooks for parallel tool calls run concurrently, so an append takes a lock
// (an exclusive mkdir) around read-last-then-write. A hook must never block
// the agent, so a lock that cannot be taken quickly is given up on and the
// event is dropped with a note; the chain stays valid, just shorter.

import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent, EventDraft } from '../events/schema.js';
import { type ChainVerdict, chainEvent, verifyLines } from './chain.js';

const LOCK_WAIT_MS = 250;
const LOCK_STALE_MS = 5_000;
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function sessionsDir(dataDir: string): string {
  return join(dataDir, 'sessions');
}

export function logPath(dataDir: string, session: string): string {
  if (!SESSION_ID.test(session)) throw new Error(`invalid session id: ${session}`);
  return join(sessionsDir(dataDir), `${session}.jsonl`);
}

function rootPath(dataDir: string, session: string): string {
  return logPath(dataDir, session).replace(/\.jsonl$/, '.root');
}

export interface SessionRoot {
  root: string;
  seq: number;
  closed_at: string;
  reason: string;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock<T>(path: string, fn: () => T): T | undefined {
  const lock = `${path}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmdirSync(lock);
      } catch {
        // Someone else removed it; try again.
      }
      if (Date.now() > deadline) return undefined;
      sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      // Already gone; nothing to release.
    }
  }
}

/** The last complete line of a file, read from its tail. */
function lastLine(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    let chunk = 4096;
    for (;;) {
      const start = Math.max(0, size - chunk);
      const buf = Buffer.alloc(size - start);
      readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      if (lines.length > 1 || start === 0) return lines.at(-1);
      chunk *= 4;
    }
  } finally {
    closeSync(fd);
  }
}

export type AppendResult =
  | { status: 'appended'; event: AgentEvent }
  | { status: 'skipped'; reason: string };

/** Appends one event to a session, chaining it to the last one on disk. */
export function appendEvent(
  dataDir: string,
  session: string,
  draft: EventDraft,
  now: Date = new Date()
): AppendResult {
  const path = logPath(dataDir, session);
  if (existsSync(rootPath(dataDir, session))) {
    return { status: 'skipped', reason: 'session is already closed' };
  }
  mkdirSync(sessionsDir(dataDir), { recursive: true, mode: 0o700 });
  const result = withLock(path, () => {
    const tail = lastLine(path);
    const last = tail ? (JSON.parse(tail) as AgentEvent) : undefined;
    const event = chainEvent(session, last, draft, now);
    appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  });
  return result
    ? { status: 'appended', event: result }
    : { status: 'skipped', reason: 'log is locked by another writer' };
}

/** Appends a closing marker and records the root hash. Closing twice is a no-op. */
export function closeSession(
  dataDir: string,
  session: string,
  reason: string,
  host: EventDraft['host'],
  now: Date = new Date()
): SessionRoot | undefined {
  if (!existsSync(logPath(dataDir, session))) return undefined;
  if (existsSync(rootPath(dataDir, session))) return readRoot(dataDir, session);
  const end = appendEvent(
    dataDir,
    session,
    { host, kind: 'session', subject: `end:${reason}` },
    now
  );
  if (end.status !== 'appended') return undefined;
  const root: SessionRoot = {
    root: end.event.hash,
    seq: end.event.seq,
    closed_at: now.toISOString(),
    reason
  };
  writeFileSync(rootPath(dataDir, session), `${JSON.stringify(root)}\n`, { mode: 0o600 });
  return root;
}

export function readRoot(dataDir: string, session: string): SessionRoot | undefined {
  const path = rootPath(dataDir, session);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as SessionRoot;
}

export function readEvents(dataDir: string, session: string): AgentEvent[] {
  const path = logPath(dataDir, session);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentEvent);
}

export interface SessionSummary {
  session: string;
  events: number;
  modified: string;
  closed: boolean;
}

/** Sessions on disk, most recently written first. */
export function listSessions(dataDir: string): SessionSummary[] {
  const dir = sessionsDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => {
      const session = f.slice(0, -'.jsonl'.length);
      const path = join(dir, f);
      return {
        session,
        events: readFileSync(path, 'utf8').split('\n').filter(Boolean).length,
        modified: statSync(path).mtime.toISOString(),
        closed: existsSync(rootPath(dataDir, session))
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
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
