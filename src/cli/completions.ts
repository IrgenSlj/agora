/**
 * Pure completion providers for the Agora shell prompter.
 * All functions are side-effect-free; callers inject I/O via context.
 */

import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

export interface CompletionResult {
  matches: string[];
  replaceFrom: number;
}

export interface CompletionContext {
  slashCommands: string[];
  agoraCommands: string[];
  marketplaceIds: () => string[];
  savedIds: () => string[];
  listDir: (path: string) => string[];
  cwd: string;
}

const PATH_COMMANDS = new Set(['cd', 'ls', 'cat', 'vi', 'vim', 'nano', 'less', 'more']);
const MARKETPLACE_COMMANDS = new Set(['install', 'browse']);
const SAVED_COMMANDS = new Set(['remove']);

export function completeShellLine(
  line: string,
  cursor: number,
  context: CompletionContext
): CompletionResult {
  const upToCursor = line.slice(0, cursor);
  const trimmed = upToCursor.trimStart();

  // Rule 1: empty or slash prefix → slash completions
  if (!trimmed || trimmed.startsWith('/')) {
    return completeSlash(trimmed, upToCursor, context);
  }

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0];

  // Rule 2: path commands
  if (PATH_COMMANDS.has(firstToken)) {
    const lastToken = upToCursor.split(/\s+/).pop() ?? '';
    const replaceFrom = upToCursor.length - lastToken.length;
    return completePath(lastToken, replaceFrom, context);
  }

  // Rule 3: marketplace/saved commands with a second token being typed
  if (tokens.length >= 2 || (tokens.length === 1 && upToCursor.endsWith(' '))) {
    if (MARKETPLACE_COMMANDS.has(firstToken)) {
      const secondToken = tokens[1] ?? '';
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.marketplaceIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    if (firstToken === 'save') {
      const secondToken = tokens[1] ?? '';
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.marketplaceIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    if (SAVED_COMMANDS.has(firstToken)) {
      const secondToken = tokens[1] ?? '';
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.savedIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }
  }

  return { matches: [], replaceFrom: cursor };
}

function completeSlash(
  trimmed: string,
  upToCursor: string,
  context: CompletionContext
): CompletionResult {
  // Token is the slash-prefixed word from the start
  const prefix = trimmed;
  const replaceFrom = upToCursor.length - prefix.length;
  const matches = context.slashCommands
    .filter((cmd) => cmd.startsWith(prefix))
    .sort()
    .slice(0, 12);
  return { matches, replaceFrom };
}

function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

function completePath(
  token: string,
  replaceFrom: number,
  context: CompletionContext
): CompletionResult {
  const expanded = expandHome(token);
  const absolute = expanded.startsWith('/') ? expanded : resolve(context.cwd, expanded);

  // Determine directory to list and prefix to match
  let dir: string;
  let filePrefix: string;
  if (token.endsWith('/') || token.endsWith('~/')) {
    dir = absolute;
    filePrefix = '';
  } else {
    dir = dirname(absolute);
    filePrefix = basename(absolute);
  }

  // Normalize dir: remove trailing slash unless it is the root
  const normalizedDir = dir !== '/' && dir.endsWith('/') ? dir.slice(0, -1) : dir;

  let entries: string[];
  try {
    entries = context.listDir(normalizedDir);
  } catch {
    return { matches: [], replaceFrom };
  }

  const matches = entries
    .filter((e) => e.startsWith(filePrefix))
    .map((e) => {
      // Reconstruct the token-relative path
      const base = token.endsWith('/') ? token : token.slice(0, token.length - filePrefix.length);
      return base + e;
    })
    .sort()
    .slice(0, 12);

  return { matches, replaceFrom };
}

// ── Ghost suggester ──────────────────────────────────────────────────────────

/**
 * Returns the suffix needed to complete `line` from the most recent history
 * entry that starts with `line` (but isn't equal to it). Returns null when
 * there is no such entry or line is empty after trimming.
 */
export function ghostFromHistory(line: string, history: string[]): string | null {
  if (!line.trim()) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry.startsWith(line) && entry !== line) {
      return entry.slice(line.length);
    }
  }
  return null;
}
