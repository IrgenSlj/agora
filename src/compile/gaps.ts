// What each host cannot enforce or record, in one place: `agora plan` lists
// these, and every receipt carries the ones for the hosts its sessions ran in,
// so a reader never assumes the log is complete (AGENTS.md rule 5).

import type { AgentEvent } from '../events/schema.js';

export const CLAUDE_CODE_GAPS = [
  'files read or written by shell commands (cat, sed, redirects): only the program name is checked',
  'network connections made by shell commands: connect rules govern WebFetch only',
  "an MCP server's own file and network access: use `agora run` to record its peers",
  'permissions.allow rules apply only after the folder is trusted in Claude Code'
];

export const OPENCODE_GAPS = [
  'files read or written by shell commands (cat, sed, redirects): only the program name is checked',
  'network connections made by shell commands: connect rules govern webfetch only',
  'MCP tools are seen as plain tool names (`<server>_<tool>`), so the revocation list does not apply to them',
  'approval prompts are not recorded, so OpenCode sessions do not count toward fewer approvals',
  'sessions are closed only when OpenCode deletes them; an open log cannot detect truncation'
];

export const MCP_SHIM_GAPS = [
  'only MCP tool calls and sampled peers of the server process are recorded'
];

export const HOST_GAPS: Record<AgentEvent['host'], string[]> = {
  'claude-code': CLAUDE_CODE_GAPS,
  opencode: OPENCODE_GAPS,
  'mcp-shim': MCP_SHIM_GAPS
};

/** The receipt form: one line per gap, prefixed by its host. */
export function receiptGaps(hosts: Iterable<AgentEvent['host']>): string[] {
  return [...new Set(hosts)].sort().flatMap((h) => HOST_GAPS[h].map((g) => `${h}: ${g}`));
}
