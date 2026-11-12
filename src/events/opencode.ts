// OpenCode tool calls → AgentEvent drafts.
//
// OpenCode has no command hooks; it loads plugins. Agora's plugin
// (`src/compile/opencode.ts` writes it) forwards `tool.execute.before` and
// `tool.execute.after` to `agora hook check` and `agora hook record` as a
// payload shaped like Claude Code's, marked `host: "opencode"`, with
// OpenCode's own tool names and argument keys.
//
// Tool names and argument keys were read from a live OpenCode 1.19.3 session on
// 2026-11-12 (the plugin API types are @opencode-ai/plugin 1.19.5; the docs page
// https://opencode.ai/docs/plugins/ does not list them): `read`, `write` and
// `edit` take `filePath`; `bash` takes `command`; `glob` and `grep` take an
// optional `path`; `webfetch` takes `url`. MCP tools are named
// `<server>_<tool>` with unsupported characters turned into `_`
// (https://opencode.ai/docs/permissions/), which cannot be split back into a
// server and a tool, so they are recorded as plain tool names.
//
// What leaves this file is an identifier, never content (AGENTS.md rule 6).

import { netSubject, pathSubject, programName } from './claude-code.js';
import type { EventDecision, EventDraft } from './schema.js';

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export interface OpenCodeToolCall {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  cwd?: string;
}

export function normaliseOpenCode(
  payload: OpenCodeToolCall,
  decision: EventDecision = 'allowed'
): EventDraft[] {
  const tool = str(payload.tool_name);
  if (!tool) return [];
  const input = payload.tool_input ?? {};
  const repo = str(payload.cwd) ?? process.cwd();
  const draft = (kind: EventDraft['kind'], subject: string): EventDraft[] => [
    { host: 'opencode', kind, subject, decision }
  ];

  switch (tool) {
    case 'read':
      return draft('file_read', pathSubject(str(input.filePath) ?? '.', repo));
    case 'glob':
    case 'grep':
    case 'list':
      return draft('file_read', pathSubject(str(input.path) ?? '.', repo));
    case 'write':
    case 'edit':
      return draft('file_write', pathSubject(str(input.filePath) ?? '.', repo));
    case 'bash':
      return draft('exec', programName(str(input.command) ?? ''));
    case 'webfetch': {
      const peer = netSubject(str(input.url) ?? '');
      return peer ? draft('net', peer) : draft('tool_call', 'tool:webfetch');
    }
    default:
      return draft('tool_call', NAME.test(tool) ? `tool:${tool}` : 'tool:unknown');
  }
}
