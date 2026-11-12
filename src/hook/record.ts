// `agora hook record`: write what Claude Code or OpenCode did into the session log.
//
// Registered for SessionStart, PostToolUse, PermissionRequest, PermissionDenied
// and SessionEnd
// (https://code.claude.com/docs/en/hooks, read 2026-11-11). It never prints to
// stdout, because PostToolUse reads stdout as a decision, and it always exits
// 0: recording is never a reason to interfere with the agent (AGENTS.md rule 4).

import { type HookPayload, hostOf, normaliseHook } from '../events/hook-payload.js';
import type { EventDecision } from '../events/schema.js';
import { appendEvent, closeSession, ensureMeta } from '../log/store.js';
import { detectAgoraDataDir } from '../state.js';
import { readStdin } from './run.js';

const SESSION = /^[A-Za-z0-9._-]{1,128}$/;
const LABEL = /^[A-Za-z0-9_-]{1,32}$/;

function note(message: string): void {
  process.stderr.write(`agora hook: ${message}\n`);
}

function dataDirFor(payload: HookPayload): string {
  return detectAgoraDataDir({ cwd: payload.cwd, env: process.env });
}

/** Appends the drafts for one tool event. Returns how many were written. */
export function recordDrafts(payload: HookPayload, decision: EventDecision): number {
  const session = payload.session_id;
  if (!session || !SESSION.test(session)) return 0;
  const dataDir = dataDirFor(payload);
  let written = 0;
  for (const draft of normaliseHook(payload, decision)) {
    const result = appendEvent(dataDir, session, draft);
    if (result.status === 'appended') written++;
    else note(`event not recorded: ${result.reason}`);
  }
  return written;
}

/** Records a touch of a canary: a `canary` event, denied, naming the decoy. */
export function recordCanary(payload: HookPayload, file: string): void {
  const session = payload.session_id;
  if (!session || !SESSION.test(session)) return;
  const dataDir = dataDirFor(payload);
  if (typeof payload.cwd === 'string' && payload.cwd) ensureMeta(dataDir, session, payload.cwd);
  appendEvent(dataDir, session, {
    host: hostOf(payload),
    kind: 'canary',
    subject: file,
    decision: 'denied'
  });
}

export function recordPayload(payload: HookPayload & { source?: string }): void {
  const session = payload.session_id;
  if (!session || !SESSION.test(session)) {
    note('payload has no usable session_id; nothing recorded.');
    return;
  }
  const label = (value: unknown) =>
    typeof value === 'string' && LABEL.test(value) ? value : 'other';
  if (typeof payload.cwd === 'string' && payload.cwd) {
    try {
      ensureMeta(dataDirFor(payload), session, payload.cwd);
    } catch {
      note('session metadata not written; receipts cannot bind this session to commits.');
    }
  }

  switch (payload.hook_event_name) {
    case 'SessionStart':
      appendEvent(dataDirFor(payload), session, {
        host: hostOf(payload),
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
    case 'PermissionRequest': {
      // Claude Code is about to ask a person. Counting these is how a policy
      // shows it reduced prompts (docs/PLAN.md, phase 3 gate).
      const tool = normaliseHook(payload, 'asked')[0];
      if (tool) {
        appendEvent(dataDirFor(payload), session, {
          host: hostOf(payload),
          kind: 'approval',
          subject: tool.subject,
          decision: 'asked'
        });
      }
      return;
    }
    case 'SessionEnd':
      closeSession(dataDirFor(payload), session, label(payload.reason), hostOf(payload));
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
