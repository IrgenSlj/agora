// One hook payload, from whichever host sent it.
//
// Claude Code calls `agora hook` directly. Agora's OpenCode plugin sends the
// same shape with `host: "opencode"` and OpenCode's own tool names.

import { findGitRoot } from '../log/store.js';
import { type ClaudeCodePayload, normaliseClaudeCode } from './claude-code.js';
import { normaliseOpenCode } from './opencode.js';
import type { EventDecision, EventDraft } from './schema.js';

export type HookHost = 'claude-code' | 'opencode';

export interface HookPayload extends ClaudeCodePayload {
  host?: string;
}

export const hostOf = (payload: HookPayload): HookHost =>
  payload.host === 'opencode' ? 'opencode' : 'claude-code';

/**
 * Paths are made relative to the repository, not to wherever the agent's shell
 * happens to be: a session that `cd`s into a subdirectory still names files
 * from the root, so the same file is the same subject in every event.
 */
export function normaliseHook(
  payload: HookPayload,
  decision: EventDecision = 'allowed'
): EventDraft[] {
  const root = payload.cwd ? (findGitRoot(payload.cwd) ?? payload.cwd) : undefined;
  const p = root ? { ...payload, cwd: root } : payload;
  return hostOf(p) === 'opencode'
    ? normaliseOpenCode(p, decision)
    : normaliseClaudeCode(p, decision);
}
