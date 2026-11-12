// One hook payload, from whichever host sent it.
//
// Claude Code calls `agora hook` directly. Agora's OpenCode plugin sends the
// same shape with `host: "opencode"` and OpenCode's own tool names.

import { type ClaudeCodePayload, normaliseClaudeCode } from './claude-code.js';
import { normaliseOpenCode } from './opencode.js';
import type { EventDecision, EventDraft } from './schema.js';

export type HookHost = 'claude-code' | 'opencode';

export interface HookPayload extends ClaudeCodePayload {
  host?: string;
}

export const hostOf = (payload: HookPayload): HookHost =>
  payload.host === 'opencode' ? 'opencode' : 'claude-code';

export function normaliseHook(
  payload: HookPayload,
  decision: EventDecision = 'allowed'
): EventDraft[] {
  return hostOf(payload) === 'opencode'
    ? normaliseOpenCode(payload, decision)
    : normaliseClaudeCode(payload, decision);
}
