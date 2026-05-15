/**
 * Raw-mode line editor with tab completion, ghost-text suggestions, and
 * history navigation. The public surface is readLine(); the internal state
 * machine is exposed via applyKeyEvent() for unit testing without I/O.
 */

export interface PromptOptions {
  prompt: string;
  history: string[];
  completer?: (line: string, cursor: number) => { matches: string[]; replaceFrom: number };
  /** Optional. Returns a footer line rendered on the row below the input, repainted on every keystroke. */
  footer?: (line: string) => string;
  ghostSuggester?: (line: string, history: string[]) => string | null;
  /**
   * Optional. Called on every redraw to compute the trailing portion of the
   * prompt (chevron + dispatch hint). Assembled as: opts.prompt + promptSuffix(line).
   * Returning undefined falls back to an empty string.
   */
  promptSuffix?: (line: string) => string;
  out?: NodeJS.WriteStream;
  in?: NodeJS.ReadStream;
}

export type PromptResult = { kind: 'line'; value: string } | { kind: 'eof' } | { kind: 'abort' };

// ── State ───────────────────────────────────────────────────────────────────

export interface TabCycle {
  matches: string[];
  index: number;
  replaceFrom: number;
}

export type EditorMode = 'normal' | 'reverse-search';

export interface EditorState {
  line: string;
  cursor: number;
  history: string[];
  historyIndex: number;
  draft: string;
  ghost: string | null;
  mode: EditorMode;
  searchQuery: string;
  searchIndex: number;
  tabCycle: TabCycle | null;
}

// ── Event types ─────────────────────────────────────────────────────────────

export type KeyEvent =
  | { kind: 'char'; data: string }
  | { kind: 'backspace' }
  | { kind: 'enter' }
  | { kind: 'tab' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'home' }
  | { kind: 'end' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'ctrl-c' }
  | { kind: 'ctrl-d' }
  | { kind: 'ctrl-r' }
  | { kind: 'ctrl-l' }
  | { kind: 'ctrl-f' }
  | { kind: 'ctrl-w' }
  | { kind: 'ctrl-u' }
  | { kind: 'ctrl-k' }
  | { kind: 'esc' };

export interface ApplyResult {
  state: EditorState;
  output?: PromptResult;
  // Side-effect hints for the renderer — the readLine shell interprets these
  sideEffect?: 'clear-screen' | 'show-completions';
  completionsToShow?: string[];
}

export function makeInitialState(history: string[]): EditorState {
  return {
    line: '',
    cursor: 0,
    history,
    historyIndex: history.length,
    draft: '',
    ghost: null,
    mode: 'normal',
    searchQuery: '',
    searchIndex: -1,
    tabCycle: null
  };
}

// ── Pure state machine ──────────────────────────────────────────────────────

export function applyKeyEvent(
  state: EditorState,
  event: KeyEvent,
  opts: {
    completer?: (line: string, cursor: number) => { matches: string[]; replaceFrom: number };
    ghostSuggester?: (line: string, history: string[]) => string | null;
  } = {}
): ApplyResult {
  // Reverse-i-search mode has its own dispatch
  if (state.mode === 'reverse-search') {
    return applySearchEvent(state, event);
  }

  switch (event.kind) {
    case 'ctrl-c':
      return { state, output: { kind: 'abort' } };

    case 'ctrl-d': {
      if (state.line === '') {
        return { state, output: { kind: 'eof' } };
      }
      // Forward delete
      const chars = Array.from(state.line);
      if (state.cursor < chars.length) {
        chars.splice(state.cursor, 1);
        const next = withGhost({ ...state, line: chars.join('') }, opts);
        return { state: next };
      }
      return { state };
    }

    case 'enter': {
      const next = { ...state, ghost: null, tabCycle: null };
      return { state: next, output: { kind: 'line', value: state.line } };
    }

    case 'char': {
      const chars = Array.from(state.line);
      chars.splice(state.cursor, 0, ...Array.from(event.data));
      const newCursor = state.cursor + Array.from(event.data).length;
      const newLine = chars.join('');
      const next = withGhost(
        { ...state, line: newLine, cursor: newCursor, tabCycle: null },
        opts
      );
      // Auto-complete: show slash-command completions as soon as '/' is typed
      if (newLine.startsWith('/') && opts.completer) {
        const result = opts.completer(newLine, newCursor);
        if (result.matches.length > 0) {
          return { state: next, sideEffect: 'show-completions', completionsToShow: result.matches.slice(0, 6) };
        }
      }
      return { state: next };
    }

    case 'backspace': {
      if (state.cursor === 0) return { state };
      const chars = Array.from(state.line);
      chars.splice(state.cursor - 1, 1);
      const newLine = chars.join('');
      const next = withGhost(
        { ...state, line: newLine, cursor: state.cursor - 1, tabCycle: null },
        opts
      );
      // Auto-complete: update slash-command completions when backspacing inside a slash prefix
      if (newLine.startsWith('/') && opts.completer) {
        const result = opts.completer(newLine, Math.min(newLine.length, state.cursor - 1));
        if (result.matches.length > 0) {
          return { state: next, sideEffect: 'show-completions', completionsToShow: result.matches.slice(0, 6) };
        }
      }
      return { state: next };
    }

    case 'left': {
      const next = { ...state, cursor: Math.max(0, state.cursor - 1), tabCycle: null };
      return { state: next };
    }

    case 'right': {
      const chars = Array.from(state.line);
      if (state.cursor >= chars.length && state.ghost) {
        // Accept ghost
        const newLine = state.line + state.ghost;
        const next = withGhost(
          { ...state, line: newLine, cursor: newLine.length, ghost: null, tabCycle: null },
          opts
        );
        return { state: next };
      }
      const next = {
        ...state,
        cursor: Math.min(chars.length, state.cursor + 1),
        tabCycle: null
      };
      return { state: next };
    }

    case 'ctrl-f': {
      const chars = Array.from(state.line);
      if (state.cursor >= chars.length && state.ghost) {
        const newLine = state.line + state.ghost;
        const next = withGhost(
          { ...state, line: newLine, cursor: newLine.length, ghost: null, tabCycle: null },
          opts
        );
        return { state: next };
      }
      const next = {
        ...state,
        cursor: Math.min(chars.length, state.cursor + 1),
        tabCycle: null
      };
      return { state: next };
    }

    case 'home': {
      return { state: { ...state, cursor: 0, tabCycle: null } };
    }

    case 'end': {
      return { state: { ...state, cursor: Array.from(state.line).length, tabCycle: null } };
    }

    case 'up': {
      if (state.historyIndex <= 0) return { state };
      const saveDraft = state.historyIndex === state.history.length ? state.line : state.draft;
      const newIndex = state.historyIndex - 1;
      const newLine = state.history[newIndex] ?? '';
      const next = withGhost(
        {
          ...state,
          line: newLine,
          cursor: Array.from(newLine).length,
          historyIndex: newIndex,
          draft: saveDraft,
          tabCycle: null
        },
        opts
      );
      return { state: next };
    }

    case 'down': {
      if (state.historyIndex >= state.history.length) return { state };
      const newIndex = state.historyIndex + 1;
      const newLine =
        newIndex === state.history.length ? state.draft : (state.history[newIndex] ?? '');
      const next = withGhost(
        {
          ...state,
          line: newLine,
          cursor: Array.from(newLine).length,
          historyIndex: newIndex,
          tabCycle: null
        },
        opts
      );
      return { state: next };
    }

    case 'ctrl-l': {
      return { state, sideEffect: 'clear-screen' };
    }

    case 'ctrl-r': {
      const searchIdx = findPrevMatch(state.history, state.searchQuery, state.history.length - 1);
      return {
        state: {
          ...state,
          mode: 'reverse-search',
          searchQuery: '',
          searchIndex: searchIdx,
          tabCycle: null
        }
      };
    }

    case 'ctrl-w': {
      // Delete word backward
      const chars = Array.from(state.line);
      let pos = state.cursor;
      // Skip trailing spaces
      while (pos > 0 && chars[pos - 1] === ' ') pos -= 1;
      // Delete word chars
      while (pos > 0 && chars[pos - 1] !== ' ') pos -= 1;
      chars.splice(pos, state.cursor - pos);
      const next = withGhost({ ...state, line: chars.join(''), cursor: pos, tabCycle: null }, opts);
      return { state: next };
    }

    case 'ctrl-u': {
      const chars = Array.from(state.line);
      chars.splice(0, state.cursor);
      const next = withGhost({ ...state, line: chars.join(''), cursor: 0, tabCycle: null }, opts);
      return { state: next };
    }

    case 'ctrl-k': {
      const chars = Array.from(state.line);
      const newLine = chars.slice(0, state.cursor).join('');
      const next = withGhost({ ...state, line: newLine, tabCycle: null }, opts);
      return { state: next };
    }

    case 'esc': {
      return { state: { ...state, ghost: null, tabCycle: null } };
    }

    case 'tab': {
      if (!opts.completer) return { state };

      // If there's an active tabCycle, cycle through its stored matches
      if (state.tabCycle && state.tabCycle.matches.length > 1) {
        const nextIndex = (state.tabCycle.index + 1) % state.tabCycle.matches.length;
        const match = state.tabCycle.matches[nextIndex];
        const newLine = spliceMatch(state.line, state.tabCycle.replaceFrom, state.cursor, match);
        const next = withGhost(
          {
            ...state,
            line: newLine,
            cursor: state.tabCycle.replaceFrom + Array.from(match).length,
            tabCycle: { ...state.tabCycle, index: nextIndex }
          },
          opts
        );
        return { state: next };
      }

      const result = opts.completer(state.line, state.cursor);
      if (result.matches.length === 0) return { state };

      if (result.matches.length === 1) {
        const match = result.matches[0];
        const newLine = spliceMatch(state.line, result.replaceFrom, state.cursor, match);
        const newCursor = result.replaceFrom + Array.from(match).length;
        const next = withGhost(
          { ...state, line: newLine, cursor: newCursor, tabCycle: null },
          opts
        );
        return { state: next };
      }

      // Multiple matches: show list, replace with longest common prefix
      const lcp = longestCommonPrefix(result.matches);
      const newLine = spliceMatch(state.line, result.replaceFrom, state.cursor, lcp);
      const newCursor = result.replaceFrom + Array.from(lcp).length;
      const next = withGhost(
        {
          ...state,
          line: newLine,
          cursor: newCursor,
          tabCycle: { matches: result.matches, index: -1, replaceFrom: result.replaceFrom }
        },
        opts
      );
      return {
        state: next,
        sideEffect: 'show-completions',
        completionsToShow: result.matches.slice(0, 6)
      };
    }

    default:
      return { state };
  }
}

// ── Reverse-i-search ─────────────────────────────────────────────────────────

function applySearchEvent(state: EditorState, event: KeyEvent): ApplyResult {
  if (event.kind === 'esc') {
    return {
      state: {
        ...state,
        mode: 'normal',
        searchQuery: '',
        searchIndex: -1
      }
    };
  }

  if (event.kind === 'enter') {
    const matched = state.searchIndex >= 0 ? (state.history[state.searchIndex] ?? '') : state.line;
    return {
      state: {
        ...state,
        mode: 'normal',
        line: matched,
        cursor: Array.from(matched).length,
        searchQuery: '',
        searchIndex: -1
      },
      output: { kind: 'line', value: matched }
    };
  }

  if (event.kind === 'ctrl-r') {
    // Cycle to older match
    const startFrom = state.searchIndex > 0 ? state.searchIndex - 1 : state.history.length - 1;
    const nextIdx = findPrevMatch(state.history, state.searchQuery, startFrom);
    return { state: { ...state, searchIndex: nextIdx } };
  }

  if (event.kind === 'ctrl-c') {
    return {
      state: { ...state, mode: 'normal', searchQuery: '', searchIndex: -1 },
      output: { kind: 'abort' }
    };
  }

  if (event.kind === 'backspace') {
    const newQuery = state.searchQuery.slice(0, -1);
    const idx = findPrevMatch(state.history, newQuery, state.history.length - 1);
    return { state: { ...state, searchQuery: newQuery, searchIndex: idx } };
  }

  if (event.kind === 'char') {
    const newQuery = state.searchQuery + event.data;
    const idx = findPrevMatch(state.history, newQuery, state.history.length - 1);
    return { state: { ...state, searchQuery: newQuery, searchIndex: idx } };
  }

  return { state };
}

function findPrevMatch(history: string[], query: string, startFrom: number): number {
  if (!query) return -1;
  for (let i = startFrom; i >= 0; i -= 1) {
    if (history[i].includes(query)) return i;
  }
  return -1;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function withGhost(
  state: EditorState,
  opts: { ghostSuggester?: (line: string, history: string[]) => string | null }
): EditorState {
  if (!opts.ghostSuggester) return { ...state, ghost: null };
  const ghost = opts.ghostSuggester(state.line, state.history);
  return { ...state, ghost };
}

function spliceMatch(line: string, replaceFrom: number, cursor: number, match: string): string {
  const chars = Array.from(line);
  chars.splice(replaceFrom, cursor - replaceFrom, ...Array.from(match));
  return chars.join('');
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i += 1) {
    while (!strs[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

// ── Rendering helpers ────────────────────────────────────────────────────────

/** Visible cell width of a string with ANSI CSI escape sequences stripped. */
export function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return Array.from(s.replace(/\x1b\[[0-9;]*m/g, '')).length;
}

export function renderPromptFrame(state: EditorState, prompt: string, footer: string): string {
  const ghost = state.ghost ? `\x1b[2m${state.ghost}\x1b[0m` : '';
  const chars = Array.from(state.line);
  const before = chars.slice(0, state.cursor).join('');
  const after = chars.slice(state.cursor).join('');
  const suffix = after + ghost;

  if (!footer) {
    return `\r\x1b[K${prompt}${before}${suffix}\x1b[${Array.from(suffix).length}D`;
  }

  const footerLines = footer.split('\n');
  const cursorCol = visibleWidth(prompt) + Array.from(before).length;
  const footerStr = footerLines.map((line) => `\n\r\x1b[K${line}`).join('');
  return (
    `\r\x1b[K${prompt}${before}${suffix}` +
    footerStr +
    `\x1b[${footerLines.length}A\r` +
    (cursorCol > 0 ? `\x1b[${cursorCol}C` : '')
  );
}

function renderSearch(state: EditorState, _prompt: string): string {
  const matched = state.searchIndex >= 0 ? (state.history[state.searchIndex] ?? '') : '';
  return `\r\x1b[K(reverse-i-search)\`${state.searchQuery}\`: ${matched}`;
}

// ── Main readLine ────────────────────────────────────────────────────────────

export async function readLine(opts: PromptOptions): Promise<PromptResult> {
  const out = opts.out ?? process.stdout;
  const inp = opts.in ?? process.stdin;

  return new Promise<PromptResult>((resolve) => {
    let state = makeInitialState(opts.history);
    // Compute initial ghost
    if (opts.ghostSuggester) {
      state = { ...state, ghost: opts.ghostSuggester('', opts.history) };
    }

    // Emit initial prompt (with suffix computed for empty initial line)
    out.write(opts.prompt + (opts.promptSuffix ? opts.promptSuffix('') : ''));

    // Accumulated escape sequence buffer
    let escBuf = '';
    let escTimer: ReturnType<typeof setTimeout> | null = null;

    function flushEsc(): void {
      if (escTimer) {
        clearTimeout(escTimer);
        escTimer = null;
      }
      if (!escBuf) return;
      const seq = escBuf;
      escBuf = '';
      dispatchEscSequence(seq);
    }

    function dispatchEscSequence(seq: string): void {
      // Arrow keys and navigation
      if (seq === '\x1b[A' || seq === '\x1bOA') return dispatchEvent({ kind: 'up' });
      if (seq === '\x1b[B' || seq === '\x1bOB') return dispatchEvent({ kind: 'down' });
      if (seq === '\x1b[C' || seq === '\x1bOC') return dispatchEvent({ kind: 'right' });
      if (seq === '\x1b[D' || seq === '\x1bOD') return dispatchEvent({ kind: 'left' });
      if (seq === '\x1b[H' || seq === '\x1bOH') return dispatchEvent({ kind: 'home' });
      if (seq === '\x1b[F' || seq === '\x1bOF') return dispatchEvent({ kind: 'end' });
      // Bare Esc
      if (seq === '\x1b') return dispatchEvent({ kind: 'esc' });
    }

    // Number of footer rows in the last redraw; cleared on cleanup
    let footerRows = 0;
    // Completion hints to show in the footer area on next redraw
    let pendingCompletions: string[] | null = null;

    function dispatchEvent(event: KeyEvent): void {
      const result = applyKeyEvent(state, event, {
        completer: opts.completer,
        ghostSuggester: opts.ghostSuggester
      });
      state = result.state;

      if (result.sideEffect === 'clear-screen') {
        out.write('\x1b[2J\x1b[H');
      }

      if (result.sideEffect === 'show-completions' && result.completionsToShow) {
        pendingCompletions = result.completionsToShow;
      }

      redraw();

      if (result.output) {
        cleanup();
        resolve(result.output);
      }
    }

    function redraw(): void {
      if (state.mode === 'reverse-search') {
        footerRows = 0;
        pendingCompletions = null;
        out.write(renderSearch(state, opts.prompt));
      } else {
        const suffix = opts.promptSuffix ? opts.promptSuffix(state.line) : '';
        const footerBase = opts.footer ? opts.footer(state.line) : '';
        const parts = [footerBase];
        if (pendingCompletions && pendingCompletions.length > 0) {
          parts.push(`\x1b[2m${pendingCompletions.slice(0, 6).join(' · ')}\x1b[0m`);
          pendingCompletions = null;
        }
        const footer = parts.filter(Boolean).join('\n');
        footerRows = footer ? footer.split('\n').length : 0;
        out.write(renderPromptFrame(state, opts.prompt + suffix, footer));
      }
    }

    function onData(buf: Buffer): void {
      const bytes = [...buf];
      let i = 0;

      while (i < bytes.length) {
        const b = bytes[i];

        // Escape or continuation of escape sequence
        if (b === 0x1b || escBuf) {
          flushEsc();
          // Start new escape sequence
          escBuf = String.fromCharCode(b);
          // Collect more bytes greedily (up to 8)
          let j = i + 1;
          while (j < bytes.length && j - i < 8) {
            const nb = bytes[j];
            // Stop at printable ASCII that signals end of sequence (letters, ~)
            escBuf += String.fromCharCode(nb);
            j += 1;
            if (
              nb >= 0x40 &&
              nb <= 0x7e // final byte of CSI
            ) {
              // Don't break on '[' (0x5B) — it introduces CSI sequences,
              // so there must be at least one more byte coming.
              if (nb === 0x5b) continue;
              break;
            }
          }
          i = j;
          // Dispatch immediately if we have a complete sequence
          if (escBuf.length > 1) {
            const seq = escBuf;
            escBuf = '';
            dispatchEscSequence(seq);
          } else {
            // Wait a moment for follow-up bytes (Esc alone vs. Esc[...)
            escTimer = setTimeout(() => {
              const s = escBuf;
              escBuf = '';
              dispatchEscSequence(s || '\x1b');
            }, 10);
          }
          continue;
        }

        // Control codes
        if (b === 0x03) {
          dispatchEvent({ kind: 'ctrl-c' });
          i++;
          continue;
        }
        if (b === 0x04) {
          dispatchEvent({ kind: 'ctrl-d' });
          i++;
          continue;
        }
        if (b === 0x01) {
          dispatchEvent({ kind: 'home' });
          i++;
          continue;
        }
        if (b === 0x05) {
          dispatchEvent({ kind: 'end' });
          i++;
          continue;
        }
        if (b === 0x06) {
          dispatchEvent({ kind: 'ctrl-f' });
          i++;
          continue;
        }
        if (b === 0x07) {
          i++;
          continue;
        } // bell, ignore
        if (b === 0x08 || b === 0x7f) {
          dispatchEvent({ kind: 'backspace' });
          i++;
          continue;
        }
        if (b === 0x09) {
          dispatchEvent({ kind: 'tab' });
          i++;
          continue;
        }
        if (b === 0x0a || b === 0x0d) {
          dispatchEvent({ kind: 'enter' });
          i++;
          continue;
        }
        if (b === 0x0b) {
          dispatchEvent({ kind: 'ctrl-k' });
          i++;
          continue;
        }
        if (b === 0x0c) {
          dispatchEvent({ kind: 'ctrl-l' });
          i++;
          continue;
        }
        if (b === 0x12) {
          dispatchEvent({ kind: 'ctrl-r' });
          i++;
          continue;
        }
        if (b === 0x15) {
          dispatchEvent({ kind: 'ctrl-u' });
          i++;
          continue;
        }
        if (b === 0x17) {
          dispatchEvent({ kind: 'ctrl-w' });
          i++;
          continue;
        }

        // Printable ASCII or UTF-8 multi-byte: batch until next control
        let printable = '';
        while (i < bytes.length) {
          const cb = bytes[i];
          if (cb < 0x20 || cb === 0x7f) break;
          if (cb === 0x1b) break;
          // UTF-8 multi-byte: pass through
          printable += String.fromCharCode(cb);
          i++;
        }
        if (printable) {
          dispatchEvent({ kind: 'char', data: printable });
        }
      }
    }

    function cleanup(): void {
      inp.removeListener('data', onData);
      inp.pause();
      if (escTimer) clearTimeout(escTimer);
      if (footerRows > 0) {
        // Clear every footer row, then park cursor on the first cleared row so
        // the caller's next output flows immediately under the input.
        let seq = '';
        for (let i = 0; i < footerRows; i++) seq += '\n\r\x1b[K';
        if (footerRows > 1) seq += `\x1b[${footerRows - 1}A`;
        out.write(seq);
      } else {
        out.write('\n');
      }
      if ((inp as any).setRawMode) {
        try {
          (inp as any).setRawMode(false);
        } catch {
          /* ignore */
        }
      }
    }

    // Enter raw mode
    if ((inp as any).setRawMode) {
      try {
        (inp as any).setRawMode(true);
      } catch {
        /* ignore if not a TTY */
      }
    }
    inp.resume();
    inp.on('data', onData);
  });
}
