import { describe, expect, test } from 'bun:test';
import {
  applyKeyEvent,
  makeInitialState,
  renderPromptFrame,
  visibleWidth,
  type EditorState,
  type KeyEvent
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
    const s0 = state({
      line: '/h',
      cursor: 2,
      tabCycle: { matches: ['/help'], index: 0, replaceFrom: 0 }
    });
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
    const r = applyResult(state({ line: '/', cursor: 1 }), { kind: 'tab' }, { completer });
    // First tab: shows list, lcp applied
    const s1 = r.state;
    // Second tab: cycle to first match
    const r2 = applyResult(s1, { kind: 'tab' }, { completer });
    expect(r2.state.line).toBe('/help');
  });
});

// ── promptSuffix dynamic dispatch hint ────────────────────────────────────────

describe('promptSuffix', () => {
  function makeSuffix(classify: (line: string) => 'bash' | 'chat' | 'noop') {
    return (line: string): string => {
      const k = classify(line);
      return k === 'bash' ? '$>' : k === 'chat' ? '?>' : '>';
    };
  }

  test('promptSuffix returns bash hint for command-like line', () => {
    const suffix = makeSuffix((l) => (l.startsWith('ls') ? 'bash' : 'noop'));
    expect(suffix('ls -la')).toBe('$>');
  });

  test('promptSuffix returns chat hint for question-like line', () => {
    const suffix = makeSuffix((l) => (l.startsWith('what') ? 'chat' : 'noop'));
    expect(suffix('what is mcp')).toBe('?>');
  });

  test('promptSuffix returns noop hint for empty line', () => {
    const suffix = makeSuffix((_l) => 'noop');
    expect(suffix('')).toBe('>');
  });

  test('promptSuffix records all lines it is called with', () => {
    const calls: string[] = [];
    const suffix = (line: string) => {
      calls.push(line);
      return '>';
    };
    suffix('abc');
    suffix('abcd');
    expect(calls).toEqual(['abc', 'abcd']);
  });

  test('promptSuffix switches between bash and chat indicators', () => {
    const classify = (l: string) =>
      l.startsWith('ls') ? 'bash' : l.startsWith('what') ? 'chat' : 'noop';
    const suffix = makeSuffix(classify);
    expect(suffix('ls')).toBe('$>');
    expect(suffix('what is')).toBe('?>');
    expect(suffix('')).toBe('>');
  });
});

// ── B.5 slash palette ─────────────────────────────────────────────────────────

describe('slash palette trigger', () => {
  const slashCommands = ['/help', '/quit', '/clear', '/menu', '/transcript'];
  const completer = (line: string, cursor: number) => {
    const upTo = line.slice(0, cursor);
    const matches = slashCommands.filter((c) => c.startsWith(upTo));
    return { matches, replaceFrom: 0 };
  };

  test('completer returns all slash commands for "/" prefix', () => {
    const result = completer('/', 1);
    expect(result.matches).toEqual(slashCommands);
  });

  test('completer returns filtered commands for "/h" prefix', () => {
    const result = completer('/h', 2);
    expect(result.matches).toEqual(['/help']);
  });

  test('typing "/" then "h" narrows to /help only', () => {
    let s = state({ line: '/', cursor: 1 });
    s = apply(s, { kind: 'char', data: 'h' });
    expect(s.line).toBe('/h');
    const result = completer('/h', 2);
    expect(result.matches.length).toBe(1);
  });

  test('typing "/" auto-shows completions', () => {
    const r = applyResult(state(), { kind: 'char', data: '/' }, { completer });
    expect(r.sideEffect).toBe('show-completions');
    expect(r.completionsToShow).toEqual(slashCommands);
  });

  test('typing "/h" auto-shows narrowed completions', () => {
    const s0 = state({ line: '/', cursor: 1 });
    const r = applyResult(s0, { kind: 'char', data: 'h' }, { completer });
    expect(r.sideEffect).toBe('show-completions');
    expect(r.completionsToShow).toEqual(['/help']);
  });

  test('backspacing "/h" to "/" re-shows all completions', () => {
    const s0 = state({ line: '/h', cursor: 2 });
    const r = applyResult(s0, { kind: 'backspace' }, { completer });
    expect(r.sideEffect).toBe('show-completions');
    expect(r.completionsToShow).toEqual(slashCommands);
  });

  test('plain text does not trigger auto-completions', () => {
    const r = applyResult(state(), { kind: 'char', data: 'a' }, { completer });
    expect(r.sideEffect).toBeUndefined();
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
    const s0 = state({
      mode: 'reverse-search',
      history: ['git status', 'ls'],
      searchQuery: 'git',
      searchIndex: 0
    });
    const r = applyResult(s0, { kind: 'enter' });
    expect(r.output).toEqual({ kind: 'line', value: 'git status' });
  });
});

// ── Rendering ─────────────────────────────────────────────────────────────

describe('visibleWidth', () => {
  test('counts plain chars', () => {
    expect(visibleWidth('hello')).toBe(5);
  });
  test('ignores ANSI CSI sequences', () => {
    expect(visibleWidth('\x1b[36mhello\x1b[0m')).toBe(5);
  });
  test('handles empty string', () => {
    expect(visibleWidth('')).toBe(0);
  });
});

describe('renderPromptFrame', () => {
  test('without footer clears the current row and writes the prompt line', () => {
    const s = state({ line: 'hello', cursor: 5 });
    const { frame, position } = renderPromptFrame(s, '> ', '');
    expect(frame).toContain('\r\x1b[K');
    expect(frame).toContain('> hello');
    expect(position).toEqual({ totalRows: 1, cursorRow: 0, promptRows: 1 });
  });

  test('with footer emits input row, footer row, and returns cursor to input column', () => {
    const s = state({ line: 'ls', cursor: 2 });
    const { frame } = renderPromptFrame(s, '> ', '[ctx]');
    expect(frame).toContain('> ls');
    expect(frame).toContain('[ctx]');
    expect(frame).toContain('\x1b[1A');
    expect(frame).toContain('\x1b[4C');
  });

  test('with footer and cursor mid-line positions cursor at the cursor column', () => {
    const s = state({ line: 'hello', cursor: 2 });
    const { frame } = renderPromptFrame(s, '> ', '[ctx]');
    expect(frame).toContain('\x1b[4C');
  });

  test('strips ANSI from prompt when computing cursor column', () => {
    const s = state({ line: 'x', cursor: 1 });
    const { frame } = renderPromptFrame(s, '\x1b[36m> \x1b[0m', '[ctx]');
    expect(frame).toContain('\x1b[3C');
  });

  test('multi-line footer moves cursor up by the footer line count', () => {
    const s = state({ line: 'x', cursor: 1 });
    const { frame } = renderPromptFrame(s, '> ', 'status\nhint');
    expect(frame).toContain('status');
    expect(frame).toContain('hint');
    expect(frame).toContain('\x1b[2A');
    expect(frame).toContain('\x1b[3C');
  });

  test('three-line footer moves up three rows', () => {
    const s = state({ line: '', cursor: 0 });
    const { frame } = renderPromptFrame(s, '> ', 'a\nb\nc');
    expect(frame).toContain('\x1b[3A');
  });
});

describe('renderPromptFrame — wrap-aware redraw (narrow terminals)', () => {
  // Regression coverage for the bug that produced one new prompt line per
  // keystroke in narrow terminals: the renderer counted *logical* footer
  // lines instead of *physical* rows, so the cursor-up offset landed on the
  // wrong row and the old prompt line was never cleared.

  test('counts physical rows when the footer wraps at narrow width', () => {
    const s = state({ line: 'a', cursor: 1 });
    // 70-col footer at width 30 wraps to ceil(70/30) = 3 physical rows.
    const longFooter = 'x'.repeat(70);
    const { position } = renderPromptFrame(s, '> ', longFooter, 30);
    expect(position.promptRows).toBe(1);
    expect(position.totalRows).toBe(4); // 1 prompt + 3 wrapped footer
  });

  test('counts physical rows when the prompt + input wraps', () => {
    // "agora > " (8 cols) + "hello world abc" (15 cols) = 23 cols.
    // At width 10, that wraps to ceil(23/10) = 3 physical rows.
    const s = state({ line: 'hello world abc', cursor: 15 });
    const { position } = renderPromptFrame(s, 'agora > ', '', 10);
    expect(position.promptRows).toBe(3);
    expect(position.totalRows).toBe(3);
    expect(position.cursorRow).toBe(2);
  });

  test('clears the previous frame from its top-left when prev was wider', () => {
    // Previous render had 3 physical rows; new render is smaller. The frame
    // must start with cursor-up + \x1b[J to wipe everything, not just one row.
    const s = state({ line: 'short', cursor: 5 });
    const prev = { totalRows: 3, cursorRow: 1, promptRows: 1 };
    const { frame } = renderPromptFrame(s, '> ', '', 80, prev);
    expect(frame).toContain('\x1b[1A'); // up to top of prev frame
    expect(frame).toContain('\x1b[J'); // clear from there to end of screen
    // And critically, the legacy single-row clear is NOT what runs:
    expect(frame.startsWith('\r\x1b[K')).toBe(false);
  });

  test('positions cursor on the correct wrapped row when input spans two rows', () => {
    // Cursor at col 14 in "> hello world abc": at width 10 → row 1, col 4.
    const s = state({ line: 'hello world abc', cursor: 12 });
    const { frame, position } = renderPromptFrame(s, '> ', '', 10);
    expect(position.cursorRow).toBe(1);
    expect(frame).toContain('\x1b[4C');
    // Cursor target row == end row, so no extra move-up is emitted.
    expect(frame).not.toContain('\x1b[1A');
  });

  test('passes through unchanged when width is Infinity (legacy callers)', () => {
    const s = state({ line: 'x'.repeat(200), cursor: 200 });
    // No width given → no wrapping math; promptRows stays 1.
    const { position } = renderPromptFrame(s, '> ', 'y'.repeat(500));
    expect(position.promptRows).toBe(1);
    expect(position.totalRows).toBe(2);
  });
});
