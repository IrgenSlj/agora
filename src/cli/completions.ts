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
  marketplaceIds: () => string[];
  savedIds: () => string[];
  listDir: (path: string) => string[];
  cwd: string;
}

const PATH_COMMANDS = new Set(['cd', 'ls', 'cat', 'vi', 'vim', 'nano', 'less', 'more']);
const MARKETPLACE_COMMANDS = new Set(['install', 'browse']);
const SAVED_COMMANDS = new Set(['remove']);
const ID_ARG_COMMANDS = new Set(['similar', 'compare', 'flag', 'thread']);

const BOARDS = ['mcp', 'agents', 'tools', 'workflows', 'show', 'ask', 'meta'];
const NEWS_SOURCES = ['hn', 'reddit', 'gh', 'arxiv', 'rss'];
const NEWS_TOPICS = ['mcp', 'ai', 'agents', 'workflows', 'llm', 'tool-use', 'coding', 'security'];
const SORT_ORDERS = ['top', 'new', 'active'];
const TYPES = ['package', 'workflow'];
const TYPES_EXT = ['discussion', 'reply', 'package', 'workflow'];
const FLAG_REASONS = ['spam', 'harassment', 'undisclosed-llm', 'malicious', 'other'];

type FlagCompleter = (token: string) => string[];

const FLAG_VALUE_COMPLETERS: Record<string, FlagCompleter> = {
  '--source': (t) => NEWS_SOURCES.filter((s) => s.startsWith(t)),
  '-s': (t) => NEWS_SOURCES.filter((s) => s.startsWith(t)),
  '--topic': (t) => NEWS_TOPICS.filter((s) => s.startsWith(t)),
  '--sort': (t) => SORT_ORDERS.filter((s) => s.startsWith(t)),
  '--board': (t) => BOARDS.filter((b) => b.startsWith(t)),
  '-b': (t) => BOARDS.filter((b) => b.startsWith(t)),
  '--type': (t) => TYPES_EXT.filter((s) => s.startsWith(t)),
  '-t': (t) => TYPES.filter((s) => s.startsWith(t)),
  '--reason': (t) => FLAG_REASONS.filter((r) => r.startsWith(t)),
  '--category': (t) => {
    const cats = [
      'mcp',
      'prompt',
      'workflow',
      'skill',
      'all',
      'packages',
      'question',
      'idea',
      'showcase',
      'discussion'
    ];
    return cats.filter((c) => c.startsWith(t));
  },
  '-c': (t) => {
    const cats = ['mcp', 'prompt', 'workflow', 'skill', 'all', 'packages'];
    return cats.filter((c) => c.startsWith(t));
  },
  '--level': (t) => ['beginner', 'intermediate', 'advanced'].filter((l) => l.startsWith(t))
};

export function completeShellLine(
  line: string,
  cursor: number,
  context: CompletionContext
): CompletionResult {
  const upToCursor = line.slice(0, cursor);
  const trimmed = upToCursor.trimStart();

  if (!trimmed || trimmed.startsWith('/')) {
    return completeSlash(trimmed, upToCursor, context);
  }

  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0];

  if (PATH_COMMANDS.has(firstToken)) {
    const lastToken = upToCursor.split(/\s+/).pop() ?? '';
    const replaceFrom = upToCursor.length - lastToken.length;
    return completePath(lastToken, replaceFrom, context);
  }

  const secondToken = tokens[1] ?? '';

  // Flag value completion (--flag=value or --flag value)
  if (firstToken !== secondToken) {
    const flagMatch = secondToken.match(/^(--?\w[\w-]*)=(.+)?$/);
    if (flagMatch) {
      const flagName = flagMatch[1];
      const val = flagMatch[2] ?? '';
      const completer = FLAG_VALUE_COMPLETERS[flagName];
      if (completer) {
        const replaceFrom = upToCursor.length - val.length;
        return { matches: completer(val).slice(0, 12), replaceFrom };
      }
    }
    if (tokens.length >= 3) {
      const prevFlag = tokens[tokens.length - 2];
      const lastToken = tokens[tokens.length - 1];
      const completer = FLAG_VALUE_COMPLETERS[prevFlag];
      if (completer) {
        const replaceFrom = upToCursor.length - lastToken.length;
        return { matches: completer(lastToken).slice(0, 12), replaceFrom };
      }
    }
  }

  // Marketplace-id arg completions
  if (tokens.length >= 2 || (tokens.length === 1 && upToCursor.endsWith(' '))) {
    if (MARKETPLACE_COMMANDS.has(firstToken)) {
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.marketplaceIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    if (firstToken === 'save') {
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.marketplaceIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    if (SAVED_COMMANDS.has(firstToken)) {
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.savedIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    if (ID_ARG_COMMANDS.has(firstToken)) {
      const replaceFrom = upToCursor.length - secondToken.length;
      const ids = context.marketplaceIds().filter((id) => id.startsWith(secondToken));
      ids.sort();
      return { matches: ids.slice(0, 12), replaceFrom };
    }

    // community <board> — second token is a board name, not an id
    if (firstToken === 'community') {
      const replaceFrom = upToCursor.length - secondToken.length;
      const matches = BOARDS.filter((b) => b.startsWith(secondToken));
      return { matches: matches.slice(0, 12), replaceFrom };
    }

    // Flag-only commands: complete flag names
    const flagCmds = new Set([
      'post',
      'reply',
      'vote',
      'publish',
      'discuss',
      'review',
      'auth',
      'init',
      'use',
      'config'
    ]);
    if (flagCmds.has(firstToken) && secondToken.startsWith('-')) {
      const replaceFrom = upToCursor.length - secondToken.length;
      const knownFlags = getFlags(firstToken).filter((f) => f.startsWith(secondToken));
      return { matches: knownFlags.slice(0, 12), replaceFrom };
    }
  }

  return { matches: [], replaceFrom: cursor };
}

function completeSlash(
  trimmed: string,
  upToCursor: string,
  context: CompletionContext
): CompletionResult {
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

  let dir: string;
  let filePrefix: string;
  if (token.endsWith('/') || token.endsWith('~/')) {
    dir = absolute;
    filePrefix = '';
  } else {
    dir = dirname(absolute);
    filePrefix = basename(absolute);
  }

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
      const base = token.endsWith('/') ? token : token.slice(0, token.length - filePrefix.length);
      return base + e;
    })
    .sort()
    .slice(0, 12);

  return { matches, replaceFrom };
}

function getFlags(cmd: string): string[] {
  const map: Record<string, string[]> = {
    post: ['--board', '-b', '--title', '--content', '--content-file', '--json'],
    reply: ['--content', '--content-file', '--parent-id', '--json'],
    vote: ['--up', '--down', '--type', '--json'],
    publish: [
      '--name',
      '--description',
      '-d',
      '--npm',
      '--prompt-file',
      '--prompt',
      '--version',
      '--category',
      '-c',
      '--tags',
      '--repo',
      '--repository',
      '--model',
      '--json'
    ],
    discuss: ['--title', '--content', '--content-file', '--category', '-c', '--json'],
    review: ['--rating', '-r', '--content', '--type', '-t', '--json'],
    auth: ['--token', '--api-url', '--data-dir', '--json'],
    init: ['--dry-run', '--json', '--mcp'],
    use: ['--json'],
    config: ['--config', '--json']
  };
  return map[cmd] ?? [];
}

// ── Ghost suggester ──────────────────────────────────────────────────────────

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
