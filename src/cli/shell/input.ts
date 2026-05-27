import type { Dispatch, LetterDispatch, TuiPageId } from './types.js';

export const TUI_SLASH_ALIASES: Record<string, TuiPageId | 'default'> = {
  '/tui': 'default',
  '/home': 'home',
  '/market': 'marketplace',
  '/marketplace': 'marketplace',
  '/comm': 'community',
  '/community': 'community',
  '/news': 'news',
  '/settings': 'settings'
};

export const LETTER_SHORTCUTS: Record<string, LetterDispatch> = {
  '/a': { kind: 'meta', sub: 'again' },
  '/b': { kind: 'bash', cmd: 'agora browse' },
  '/c': { kind: 'tui', page: 'community' },
  '/d': { kind: 'bash', cmd: 'agora config doctor' },
  '/e': { kind: 'meta', sub: 'env' },
  '/f': { kind: 'meta', sub: 'fg' },
  '/g': { kind: 'bash', cmd: 'agora search' },
  '/h': { kind: 'tui', page: 'home' },
  '/i': { kind: 'bash', cmd: 'agora init' },
  '/j': { kind: 'meta', sub: 'jobs' },
  '/k': { kind: 'bash', cmd: 'agora search' },
  '/l': { kind: 'meta', sub: 'last' },
  '/m': { kind: 'tui', page: 'marketplace' },
  '/n': { kind: 'tui', page: 'news' },
  '/o': { kind: 'bash', cmd: 'agora browse' },
  '/p': { kind: 'bash', cmd: 'agora preferences' },
  '/q': { kind: 'meta', sub: 'quit' },
  '/r': { kind: 'bash', cmd: 'agora reviews' },
  '/s': { kind: 'tui', page: 'settings' },
  '/t': { kind: 'meta', sub: 'terminal' },
  '/u': { kind: 'bash', cmd: 'agora use' },
  '/v': { kind: 'meta', sub: 'verbose' },
  '/w': { kind: 'bash', cmd: 'agora watch' },
  '/x': { kind: 'bash', cmd: 'agora export' },
  '/y': { kind: 'bash', cmd: 'agora history' },
  '/z': { kind: 'bash', cmd: 'agora config doctor --fix' }
};

const SHELL_BUILTINS = new Set(['cd', 'export', 'alias', 'source', 'unset', 'umask', 'exec']);

const QUESTION_STARTERS = new Set([
  'what', 'why', 'how', 'which', 'when', 'where', 'who', 'whose',
  'should', 'shall', 'can', 'could', 'would', 'will',
  'do', 'does', 'did', 'is', 'are', 'am', 'was', 'were',
  'tell', 'explain', 'describe',
  'help', 'hi', 'hello', 'hey', 'thanks'
]);

const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const BACKTICK_RE = /^`[^`]+`/;

export function looksLikeQuestion(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (trimmed.endsWith('?')) return true;

  if (ENV_VAR_RE.test(trimmed)) return false;
  if (BACKTICK_RE.test(trimmed)) return false;

  const words = trimmed.split(/\s+/);
  const firstWord = words[0].toLowerCase();

  if (QUESTION_STARTERS.has(firstWord)) return true;

  if (
    trimmed[0] === trimmed[0].toUpperCase() &&
    trimmed[0] !== trimmed[0].toLowerCase() &&
    words.length >= 3
  ) {
    return true;
  }

  return false;
}

export function classifyInput(line: string, isExecutable: (name: string) => boolean): Dispatch {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'noop' };

  if (trimmed === '/abc') return { kind: 'meta', sub: 'abc' };
  if (trimmed === '/help') return { kind: 'meta', sub: 'help' };
  if (trimmed === '/quit') return { kind: 'meta', sub: 'quit' };
  if (trimmed === '/exit') return { kind: 'meta', sub: 'exit' };
  if (trimmed === '/clear') return { kind: 'meta', sub: 'clear' };
  if (trimmed === '/transcript') return { kind: 'meta', sub: 'transcript' };
  if (trimmed === '/menu') return { kind: 'meta', sub: 'menu' };
  if (trimmed === '/terminal') return { kind: 'meta', sub: 'terminal' };
  if (trimmed === '/verbose') return { kind: 'meta', sub: 'verbose' };
  if (trimmed === '/quiet') return { kind: 'meta', sub: 'quiet' };
  if (trimmed === '/medium') return { kind: 'meta', sub: 'medium' };
  if (trimmed === '/last') return { kind: 'meta', sub: 'last' };
  if (trimmed === '/again') return { kind: 'meta', sub: 'again' };
  if (trimmed === '/jobs') return { kind: 'meta', sub: 'jobs' };
  if (trimmed === '/fg') return { kind: 'meta', sub: 'fg' };
  if (trimmed === '/bg') return { kind: 'meta', sub: 'bg' };
  if (trimmed === '/env') return { kind: 'meta', sub: 'env' };
  if (trimmed === '/sessions') return { kind: 'meta', sub: 'sessions' };
  if (trimmed === '/recall' || trimmed.startsWith('/recall '))
    return { kind: 'meta', sub: 'recall', args: trimmed.slice(8).trim() };
  if (trimmed === '/fg' || trimmed.startsWith('/fg '))
    return { kind: 'meta', sub: 'fg', args: trimmed.slice(4).trim() };
  if (trimmed === '/bg' || trimmed.startsWith('/bg '))
    return { kind: 'meta', sub: 'bg', args: trimmed.slice(4).trim() };
  if (trimmed === '/env' || trimmed.startsWith('/env '))
    return { kind: 'meta', sub: 'env', args: trimmed.slice(5).trim() };
  if (trimmed.startsWith('/? '))
    return { kind: 'meta', sub: 'dry-run', args: trimmed.slice(3).trim() };

  if (trimmed.startsWith('!')) {
    return { kind: 'bash', cmd: trimmed.slice(1) };
  }

  if (trimmed.startsWith('?')) {
    return { kind: 'chat', msg: trimmed.slice(1).trim() };
  }

  const alias = TUI_SLASH_ALIASES[trimmed];
  if (alias) {
    return alias === 'default' ? { kind: 'tui' } : { kind: 'tui', page: alias };
  }

  const letterDisp = LETTER_SHORTCUTS[trimmed];
  if (letterDisp) {
    if (letterDisp.kind === 'meta') return { kind: 'meta', sub: letterDisp.sub as Dispatch extends { kind: 'meta' } ? Dispatch['sub'] : never };
    if (letterDisp.kind === 'tui') return { kind: 'tui', page: letterDisp.page };
    if (letterDisp.kind === 'bash') return letterDisp;
  }

  if (trimmed.startsWith('/')) {
    let rest = trimmed.slice(1).trim();
    if (rest === 'agora' || rest.startsWith('agora ')) {
      rest = rest === 'agora' ? '' : rest.slice('agora '.length).trim();
    }
    return { kind: 'bash', cmd: rest ? `agora ${rest}` : 'agora help' };
  }

  if (looksLikeQuestion(trimmed)) return { kind: 'chat', msg: trimmed };

  const firstWord = trimmed.split(/\s+/)[0];
  if (SHELL_BUILTINS.has(firstWord)) return { kind: 'bash', cmd: trimmed };
  if (isExecutable(firstWord)) return { kind: 'bash', cmd: trimmed };

  return { kind: 'chat', msg: trimmed };
}
