// Claude Code hook payload → AgentEvent drafts.
//
// Payload fields per https://code.claude.com/docs/en/hooks, read 2026-11-11:
// common `session_id`, `cwd`, `hook_event_name`; tool events add `tool_name`
// and `tool_input` (Bash `command`; Read/Write/Edit `file_path`, always
// absolute; Glob/Grep `path`; WebFetch `url`; NotebookEdit `notebook_path`).
//
// What leaves this file is an identifier, never content (AGENTS.md rule 6):
// a program name and not its arguments, a repository-relative path or a path
// class, `host:port` and not a URL, a tool name and not its input.

import { homedir, tmpdir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { EventDecision, EventDraft } from './schema.js';

export interface ClaudeCodePayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  reason?: string;
}

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const SYSTEM_ROOTS = [
  '/usr',
  '/etc',
  '/bin',
  '/sbin',
  '/opt',
  '/var',
  '/System',
  '/Library',
  '/private/etc'
];
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'builtin']);

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function within(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** A path inside the repository, relative; anything else, only its class. */
export function pathSubject(path: string, repo: string): string {
  const abs = resolve(repo, path);
  if (within(abs, repo)) return relative(repo, abs).split(sep).join('/') || '.';
  const tmpRoots = [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
  if (tmpRoots.some((t) => within(abs, t))) return 'class:tmp';
  if (within(abs, homedir())) return 'class:home';
  if (SYSTEM_ROOTS.some((t) => within(abs, t))) return 'class:system';
  return 'class:other';
}

/**
 * The program a shell command runs first, without its arguments. Leading
 * `NAME=value` assignments and wrappers such as `sudo` are skipped. Anything
 * that does not look like a program name is recorded as `unknown` rather than
 * risk recording a fragment of an argument.
 */
export function programName(command: string): string {
  const tokens = command.trim().split(/\s+/);
  for (const raw of tokens) {
    const token = raw.replace(/^['"(]+|['"]+$/g, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    if (WRAPPERS.has(token)) continue;
    const base = token.split('/').pop() ?? '';
    return /^[A-Za-z0-9._+-]{1,64}$/.test(base) ? base : 'unknown';
  }
  return 'unknown';
}

export function netSubject(url: string): string | undefined {
  try {
    const u = new URL(url);
    const port = u.port || (u.protocol === 'http:' ? '80' : u.protocol === 'https:' ? '443' : '');
    return port ? `${u.hostname}:${port}` : u.hostname;
  } catch {
    return undefined;
  }
}

function toolSubject(name: string): string {
  if (name.startsWith('mcp__')) {
    const [, server, ...tool] = name.split('__');
    const t = tool.join('__');
    if (server && t && NAME.test(server) && NAME.test(t)) return `mcp:${server}/${t}`;
    return 'mcp:unknown';
  }
  return NAME.test(name) ? `tool:${name}` : 'tool:unknown';
}

/** Drafts for one tool event. PostToolUse means the call ran, so it was allowed. */
export function normaliseClaudeCode(
  payload: ClaudeCodePayload,
  decision: EventDecision = 'allowed'
): EventDraft[] {
  const tool = str(payload.tool_name);
  if (!tool) return [];
  const input = payload.tool_input ?? {};
  const repo = str(payload.cwd) ?? process.cwd();
  const draft = (kind: EventDraft['kind'], subject: string): EventDraft[] => [
    { host: 'claude-code', kind, subject, decision }
  ];

  switch (tool) {
    case 'Read':
      return draft('file_read', pathSubject(str(input.file_path) ?? '.', repo));
    case 'Glob':
    case 'Grep':
      return draft('file_read', pathSubject(str(input.path) ?? '.', repo));
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return draft('file_write', pathSubject(str(input.file_path) ?? '.', repo));
    case 'NotebookEdit':
      return draft('file_write', pathSubject(str(input.notebook_path) ?? '.', repo));
    case 'Bash':
    case 'PowerShell':
      return draft('exec', programName(str(input.command) ?? ''));
    case 'WebFetch': {
      const peer = netSubject(str(input.url) ?? '');
      return peer ? draft('net', peer) : draft('tool_call', 'tool:WebFetch');
    }
    default:
      return draft('tool_call', toolSubject(tool));
  }
}
