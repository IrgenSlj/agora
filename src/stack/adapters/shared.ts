import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { StackEnv } from '../types.js';

/**
 * Resolve the home directory from environment or OS default.
 */
export function resolveHome(opts: StackEnv): string {
  return opts.home ?? homedir();
}

/**
 * Resolve the current working directory from environment or process default.
 */
export function resolveCwd(opts: StackEnv): string {
  return opts.cwd ?? process.cwd();
}

/**
 * Common MCP entry type used across adapters.
 */
export type McpEntry = Record<string, unknown>;

/**
 * Remote transport types (SSE, HTTP, streamable HTTP).
 */
export const REMOTE_TYPES = new Set(['sse', 'http', 'streamable-http']);

/**
 * Local transport types (stdio).
 */
export const LOCAL_TYPES = new Set(['stdio']);

/**
 * Detect whether an MCP entry represents a remote server.
 * Uses type/transport field first, then falls back to key presence.
 */
export function isRemoteEntry(entry: McpEntry): boolean {
  const t = typeof entry['type'] === 'string' ? entry['type'] : undefined;
  const tr = typeof entry['transport'] === 'string' ? entry['transport'] : undefined;
  const hasUrl = 'url' in entry;
  const hasCommand = 'command' in entry;

  if (t && REMOTE_TYPES.has(t)) return true;
  if (tr && REMOTE_TYPES.has(tr)) return true;
  if (t && LOCAL_TYPES.has(t)) return false;
  if (tr && LOCAL_TYPES.has(tr)) return false;

  if (hasCommand) return false;
  return hasUrl;
}

/**
 * Safely parse a JSON file, returning null on any error.
 */
export function parseJson(path: string): unknown | null {
  try {
    const content = readFileSync(path, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
