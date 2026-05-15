import { describe, expect, test } from 'bun:test';
import {
  applyKeyEvent,
  makeInitialState,
  type EditorState,
  type KeyEvent,
} from '../src/cli/prompter';

function state(overrides: Partial<EditorState> = {}): EditorState {
  return { ...makeInitialState([]), ...overrides };
}

function apply(s: EditorState, event: KeyEvent, opts = {}): EditorState {
  return applyKeyEvent(s, event, opts).state;
}

function applyResult(s: EditorState, event: KeyEvent, opts = {}) {
  return applyKeyEvent(s, event, opts);
}

// ── Basic editing ─────────────────────────────────────────────────────────

describe('char insertion', () => {
  test('inserts char at cursor', () => {
    const s = apply(state(), { kind: 'char', data: 'a' });
    expect(s.line).toBe('a');
    expect(s.cursor).toBe(1);
  });

  test('inserts multiple chars', () => {
    let s = state();
    s = apply(s, { kind: 'char', data: 'he' });
    s = apply(s, { kind: 'char', data: 'y' });
    expect(s.line).toBe('hey');
    expect(s.cursor).toBe(3);
  });

  test('inserts at mid-cursor', () => {
    let s = state({ line: 'ac', cursor: 1 });
    s = apply(s, { kind: 'char', data: 'b' });
    expect(s.line).toBe('abc');
    expect(s.cursor).toBe(2);
  });

  test('clears tabCycle on char', () => {
    const s0 = state({ line: '/h', cursor: 2, tabCycle: { matches: ['/help'], index: 0, replaceFrom: 0 } });
    const s1 = apply(s0, { kind: 'char', data: 'e' });
    expect(s1.tabCycle).toBeNull();
  });
});

describe('backspace', () => {
  test('deletes char before cursor', () => {
    const s = apply(state({ line: 'ab', cursor: 2 }), { kind: 'backspace' });
    expect(s.line).toBe('a');
    expect(s.cursor).toBe(1);
  });

  test('no-op at cursor 0', () => {
    const s = apply(state({ line: 'a', cursor: 0 }), { kind: 'backspace' });
    expect(s.line).toBe('a');
    expect(s.cursor).toBe(0);
  });
});

// ── Navigation ────────────────────────────────────────────────────────────

describe('cursor movement', () => {
  test('left moves cursor', () => {
    const s = apply(state({ line: 'hi', cursor: 2 }), { kind: 'left' });
    expect(s.cursor).toBe(1);
  });

  test('left clamps at 0', () => {
    const s = apply(state({ line: 'hi', cursor: 0 }), { kind: 'left' });
    expect(s.cursor).toBe(0);
  });

  test('right moves cursor', () => {
    const s = apply(state({ line: 'hi', cursor: 1 }), { kind: 'right' });
    expect(s.cursor).toBe(2);
  });

  test('right clamps at line length', () => {
    const s = apply(state({ line: 'hi', cursor: 2 }), { kind: 'right' });
    expect(s.cursor).toBe(2);
  });

  test('home moves to 0', () => {
    const s = apply(state({ line: 'hello', cursor: 3 }), { kind: 'home' });
    expect(s.cursor).toBe(0);
  });

  test('end moves to line length', () => {
    const s = apply(state({ line: 'hello', cursor: 0 }), { kind: 'end' });
    expect(s.cursor).toBe(5);
  });
});

// ── Ghost text ────────────────────────────────────────────────────────────

describe('ghost text', () => {
  const ghostSuggester = (line: string, hist: string[]) => {
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].startsWith(line) && hist[i] !== line) return hist[i].slice(line.length);
    }
    return null;
  };

  test('right at EOL with ghost accepts ghost', () => {
    const s0 = state({ line: 'gi', cursor: 2, ghost: 't status', history: ['git status'] });
    const s1 = apply(s0, { kind: 'right' }, { ghostSuggester });
    expect(s1.line).toBe('git status');
    expect(s1.cursor).toBe(10);
  });

  test('ctrl-f at EOL accepts ghost', () => {
    const s0 = state({ line: 'gi', cursor: 2, ghost: 't status' });
    const s1 = apply(s0, { kind: 'ctrl-f' });
    expect(s1.line).toBe('git status');
  });

  test('esc clears ghost', () => {
    const s0 = state({ line: 'gi', cursor: 2, ghost: 't status' });
    const s1 = apply(s0, { kind: 'esc' });
    expect(s1.ghost).toBeNull();
  });
});

// ── History navigation ─────────────────────────────────────────────────────

describe('history navigation', () => {
  const hist = ['ls', 'git status', 'echo hello'];

  test('up loads previous entry', () => {
    const s = apply(state({ history: hist, historyIndex: hist.length }), { kind: 'up' });
    expect(s.line).toBe('echo hello');
    expect(s.historyIndex).toBe(2);
  });

  test('up twice goes further back', () => {
    let s = state({ history: hist, historyIndex: hist.length });
    s = apply(s, { kind: 'up' });
    s = apply(s, { kind: 'up' });
    expect(s.line).toBe('git status');
  });

  test('down restores draft', () => {
    let s = state({ history: hist, historyIndex: hist.length, line: 'draft', cursor: 5 });
    s = apply(s, { kind: 'up' });
    s = apply(s, { kind: 'down' });
    s = apply(s, { kind: 'down' });
    s = apply(s, { kind: 'down' });
    expect(s.line).toBe('draft');
  });

  test('up at top does nothing', () => {
    const s0 = state({ history: hist, historyIndex: 0, line: 'ls' });
    const s1 = apply(s0, { kind: 'up' });
    expect(s1.historyIndex).toBe(0);
  });
});

// ── Ctrl sequences ────────────────────────────────────────────────────────

describe('ctrl-w / ctrl-u / ctrl-k', () => {
  test('ctrl-w deletes word backward', () => {
    const s = apply(state({ line: 'hello world', cursor: 11 }), { kind: 'ctrl-w' });
    expect(s.line).toBe('hello ');
    expect(s.cursor).toBe(6);
  });

  test('ctrl-u deletes to start', () => {
    const s = apply(state({ line: 'hello world', cursor: 5 }), { kind: 'ctrl-u' });
    expect(s.line).toBe(' world');
    expect(s.cursor).toBe(0);
  });

  test('ctrl-k deletes to end', () => {
    const s = apply(state({ line: 'hello world', cursor: 5 }), { kind: 'ctrl-k' });
    expect(s.line).toBe('hello');
  });
});

// ── Enter / Ctrl-C / Ctrl-D ───────────────────────────────────────────────

describe('resolve events', () => {
  test('enter resolves with line value', () => {
    const s0 = state({ line: 'ls -la', cursor: 6 });
    const r = applyResult(s0, { kind: 'enter' });
    expect(r.output).toEqual({ kind: 'line', value: 'ls -la' });
  });

  test('ctrl-c resolves with abort', () => {
    const r = applyResult(state(), { kind: 'ctrl-c' });
    expect(r.output).toEqual({ kind: 'abort' });
  });

  test('ctrl-d on empty resolves eof', () => {
    const r = applyResult(state({ line: '' }), { kind: 'ctrl-d' });
    expect(r.output).toEqual({ kind: 'eof' });
  });

  test('ctrl-d on non-empty deletes forward', () => {
    const s = apply(state({ line: 'ab', cursor: 0 }), { kind: 'ctrl-d' });
    expect(s.line).toBe('b');
    expect(s.cursor).toBe(0);
  });
});

// ── Tab completion ────────────────────────────────────────────────────────

describe('tab completion', () => {
  const completer = (line: string, cursor: number) => {
    const prefix = line.slice(0, cursor);
    const commands = ['/help', '/quit', '/menu'];
    const matches = commands.filter((c) => c.startsWith(prefix));
    return { matches, replaceFrom: 0 };
  };

  test('single match: completes inline', () => {
    const s = apply(state({ line: '/h', cursor: 2 }), { kind: 'tab' }, { completer });
    expect(s.line).toBe('/help');
    expect(s.cursor).toBe(5);
  });

  test('multiple matches: shows completions side effect and sets tabCycle', () => {
    const r = applyResult(state({ line: '/', cursor: 1 }), { kind: 'tab' }, { completer });
    expect(r.sideEffect).toBe('show-completions');
    expect(r.state.tabCycle).not.toBeNull();
    expect(r.state.tabCycle!.matches.length).toBeGreaterThan(1);
  });

  test('no matches: no side effect', () => {
    const r = applyResult(state({ line: '/z', cursor: 2 }), { kind: 'tab' }, { completer });
    expect(r.sideEffect).toBeUndefined();
    expect(r.state.tabCycle).toBeNull();
  });

  test('second tab cycles through matches', () => {
    let r = applyResult(state({ line: '/', cursor: 1 }), { kind: 'tab' }, { completer });
    // First tab: shows list, lcp applied
    const s1 = r.state;
    // Second tab: cycle to first match
    const r2 = applyResult(s1, { kind: 'tab' }, { completer });
    expect(r2.state.line).toBe('/help');
  });
});

// ── Reverse-i-search ──────────────────────────────────────────────────────

describe('reverse-i-search', () => {
  test('ctrl-r enters search mode', () => {
    const s = apply(state({ history: ['git status'] }), { kind: 'ctrl-r' });
    expect(s.mode).toBe('reverse-search');
  });

  test('esc in search mode returns to normal', () => {
    const s0 = state({ mode: 'reverse-search', history: ['git status'] });
    const s1 = apply(s0, { kind: 'esc' });
    expect(s1.mode).toBe('normal');
  });

  test('enter in search mode accepts matched entry', () => {
    const s0 = state({ mode: 'reverse-search', history: ['git status', 'ls'], searchQuery: 'git', searchIndex: 0 });
    const r = applyResult(s0, { kind: 'enter' });
    expect(r.output).toEqual({ kind: 'line', value: 'git status' });
  });
});
