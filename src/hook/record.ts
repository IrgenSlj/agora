// `agora hook record`: write what Claude Code did into the session log.
//
// Registered for SessionStart, PostToolUse, PermissionDenied and SessionEnd
// (https://code.claude.com/docs/en/hooks, read 2026-11-11). It never prints to
// stdout, because PostToolUse reads stdout as a decision, and it always exits
// 0: recording is never a reason to interfere with the agent (AGENTS.md rule 4).

import { type ClaudeCodePayload, normaliseClaudeCode } from '../events/claude-code.js';
import type { EventDecision } from '../events/schema.js';
import { appendEvent, closeSession } from '../log/store.js';
import { detectAgoraDataDir } from '../state.js';
import { readStdin } from './run.js';

const SESSION = /^[A-Za-z0-9._-]{1,128}$/;
const LABEL = /^[A-Za-z0-9_-]{1,32}$/;

function note(message: string): void {
  process.stderr.write(`agora hook: ${message}\n`);
}

function dataDirFor(payload: ClaudeCodePayload): string {
  return detectAgoraDataDir({ cwd: payload.cwd, env: process.env });
}

/** Appends the drafts for one tool event. Returns how many were written. */
export function recordDrafts(payload: ClaudeCodePayload, decision: EventDecision): number {
  const session = payload.session_id;
  if (!session || !SESSION.test(session)) return 0;
  const dataDir = dataDirFor(payload);
  let written = 0;
  for (const draft of normaliseClaudeCode(payload, decision)) {
    const result = appendEvent(dataDir, session, draft);
    if (result.status === 'appended') written++;
    else note(`event not recorded: ${result.reason}`);
  }
  return written;
}

export function recordPayload(payload: ClaudeCodePayload & { source?: string }): void {
  const session = payload.session_id;
  if (!session || !SESSION.test(session)) {
    note('payload has no usable session_id; nothing recorded.');
    return;
  }
  const label = (value: unknown) =>
    typeof value === 'string' && LABEL.test(value) ? value : 'other';

  switch (payload.hook_event_name) {
    case 'SessionStart':
      appendEvent(dataDirFor(payload), session, {
        host: 'claude-code',
        kind: 'session',
        subject: `start:${label(payload.source)}`
      });
      return;
    case 'PostToolUse':
      recordDrafts(payload, 'allowed');
      return;
    case 'PermissionDenied':
      recordDrafts(payload, 'denied');
      return;
    case 'SessionEnd':
      closeSession(dataDirFor(payload), session, label(payload.reason), 'claude-code');
      return;
    default:
      return;
  }
}

export async function runHookRecord(): Promise<number> {
  try {
    const raw = await readStdin();
    if (!raw.trim()) return 0;
    recordPayload(JSON.parse(raw));
  } catch (e) {
    note(`not recorded (${e instanceof Error ? e.message : String(e)}).`);
  }
  return 0;
}
