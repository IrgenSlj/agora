import { describe, expect, test } from 'bun:test';

// ── Minimal composer state-machine extracted for unit testing ─────────────

interface ComposerState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  title?: string;
  mode: 'reply' | 'new-thread';
  status: 'editing' | 'sending' | 'error';
  errorMessage?: string;
}

function makeComposer(mode: 'reply' | 'new-thread' = 'reply'): ComposerState {
  return {
    lines: [''],
    cursorLine: 0,
    cursorCol: 0,
    mode,
    status: 'editing'
  };
}

function insertChar(c: ComposerState, ch: string): ComposerState {
  const s = { ...c, lines: [...c.lines] };
  const line = s.lines[s.cursorLine] ?? '';
  s.lines[s.cursorLine] = line.slice(0, s.cursorCol) + ch + line.slice(s.cursorCol);
  s.cursorCol++;
  return s;
}

function backspace(c: ComposerState): ComposerState {
  const s = { ...c, lines: [...c.lines] };
  const line = s.lines[s.cursorLine] ?? '';
  if (s.cursorCol > 0) {
    s.lines[s.cursorLine] = line.slice(0, s.cursorCol - 1) + line.slice(s.cursorCol);
    s.cursorCol--;
  } else if (s.cursorLine > 0) {
    const prev = s.lines[s.cursorLine - 1] ?? '';
    s.lines.splice(s.cursorLine, 1);
    s.cursorLine--;
    s.cursorCol = prev.length;
    s.lines[s.cursorLine] = prev + line;
  }
  return s;
}

function newline(c: ComposerState): ComposerState {
  const s = { ...c, lines: [...c.lines] };
  const line = s.lines[s.cursorLine] ?? '';
  const rest = line.slice(s.cursorCol);
  s.lines[s.cursorLine] = line.slice(0, s.cursorCol);
  s.lines.splice(s.cursorLine + 1, 0, rest);
  s.cursorLine++;
  s.cursorCol = 0;
  return s;
}

function insertStr(c: ComposerState, str: string): ComposerState {
  let s = c;
  for (const ch of str) s = insertChar(s, ch);
  return s;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('composer reducer', () => {
  test('starts with empty single line', () => {
    const c = makeComposer();
    expect(c.lines).toEqual(['']);
    expect(c.cursorLine).toBe(0);
    expect(c.cursorCol).toBe(0);
  });

  test('insertChar appends character and advances cursor', () => {
    const c = insertChar(makeComposer(), 'h');
    expect(c.lines[0]).toBe('h');
    expect(c.cursorCol).toBe(1);
  });

  test('inserts multiple characters', () => {
    const c = insertStr(makeComposer(), 'hello');
    expect(c.lines[0]).toBe('hello');
    expect(c.cursorCol).toBe(5);
  });

  test('backspace removes last character', () => {
    let c = insertStr(makeComposer(), 'hello');
    c = backspace(c);
    expect(c.lines[0]).toBe('hell');
    expect(c.cursorCol).toBe(4);
  });

  test('backspace at start of line merges with previous line', () => {
    let c = insertStr(makeComposer(), 'hello');
    c = newline(c);
    c = insertStr(c, 'world');
    // cursor is at line 1 col 5
    // move cursor to col 0
    c = { ...c, cursorCol: 0 };
    c = backspace(c);
    // lines should be merged
    expect(c.lines.length).toBe(1);
    expect(c.lines[0]).toBe('helloworld');
    expect(c.cursorLine).toBe(0);
    expect(c.cursorCol).toBe(5);
  });

  test('backspace on empty first line does nothing', () => {
    const c = backspace(makeComposer());
    expect(c.lines).toEqual(['']);
    expect(c.cursorCol).toBe(0);
  });

  test('newline splits current line', () => {
    let c = insertStr(makeComposer(), 'hello');
    // put cursor at col 3
    c = { ...c, cursorCol: 3 };
    c = newline(c);
    expect(c.lines[0]).toBe('hel');
    expect(c.lines[1]).toBe('lo');
    expect(c.cursorLine).toBe(1);
    expect(c.cursorCol).toBe(0);
  });

  test('newline at end of line creates empty next line', () => {
    let c = insertStr(makeComposer(), 'hello');
    c = newline(c);
    expect(c.lines[0]).toBe('hello');
    expect(c.lines[1]).toBe('');
    expect(c.cursorLine).toBe(1);
    expect(c.cursorCol).toBe(0);
  });

  test('insertChar mid-line inserts without replacing', () => {
    let c = insertStr(makeComposer(), 'hllo');
    c = { ...c, cursorCol: 1 }; // between h and l
    c = insertChar(c, 'e');
    expect(c.lines[0]).toBe('hello');
    expect(c.cursorCol).toBe(2);
  });

  test('status starts as editing', () => {
    const c = makeComposer();
    expect(c.status).toBe('editing');
  });

  test('multi-line buffer join gives correct content', () => {
    let c = makeComposer();
    c = insertStr(c, 'line one');
    c = newline(c);
    c = insertStr(c, 'line two');
    const content = c.lines.join('\n').trim();
    expect(content).toBe('line one\nline two');
  });
});
